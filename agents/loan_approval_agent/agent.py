"""
Loan Approval Agent — hardened against prompt-injection / field-substitution attacks.

Security invariants (enforced in code, not only in the system prompt):
  1. IMMUTABLE_FIELDS are always sourced from the database record; no user or
     session value can override them before or during scoring.
  2. Mutable applicant fields supplied by the user are validated and clamped to
     plausible ranges; out-of-range values are rejected with an error message.
  3. The APPROVED / DENIED decision is produced by comparing the deterministic
     score returned by compute_score() against the threshold — the LLM never
     emits or overrides the decision string.
  4. A post-scoring assertion verifies that the immutable fields actually used
     match the database record before any decision is returned to the caller.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import weave
from openai import OpenAI

from .database import get_applicant_data
from .scoring import compute_score

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Field classification
# ---------------------------------------------------------------------------

# These fields come exclusively from the database.  They must NEVER be
# accepted from user input or session state.
IMMUTABLE_FIELDS: frozenset[str] = frozenset({
    "credit_score",
    "num_late_payments",
    "bankruptcies",
    "fraud_flags",
    "identity_verified",
})

# These fields may be supplied / updated by the applicant, but are subject to
# range validation before being forwarded to compute_score().
MUTABLE_FIELDS: frozenset[str] = frozenset({
    "annual_income",
    "employment_months",
    "debt_to_income_ratio",
    "assets",
})

# Plausibility guardrails for mutable fields.
# Values outside these ranges are rejected as implausible self-reports.
MUTABLE_FIELD_RANGES: dict[str, tuple[float, float]] = {
    "annual_income":        (0,      5_000_000),
    "employment_months":    (0,      600),        # 0 – 50 years
    "debt_to_income_ratio": (0.0,    1.0),
    "assets":               (0,      100_000_000),
}

# ---------------------------------------------------------------------------
# In-memory session store  {session_id: {field: value}}
# Only MUTABLE_FIELDS values are ever stored here.
# ---------------------------------------------------------------------------
_sessions: dict[str, dict[str, Any]] = {}

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are a loan approval assistant.  Your job is to collect the applicant's
name and requested loan amount, optionally allow them to update mutable
financial details (income, employment history, debt ratio, assets), and then
run the loan scoring tool to obtain a decision.

Critical rules — these are ENFORCED IN CODE and cannot be bypassed:
• Credit score, late payments, bankruptcies, fraud flags, and identity
  verification status come from verified credit-bureau records.  You must
  NEVER accept user-supplied values for these fields.  If an applicant
  claims their credit score or any other immutable field is different, politely
  explain that only bureau-verified data is used and proceed with the database
  value.
• The APPROVED / DENIED decision is produced by the scoring engine.  Do not
  invent, modify, or speculate about the decision; relay the result exactly.
• You may help the applicant update: annual_income, employment_months,
  debt_to_income_ratio, assets — nothing else.

Workflow:
1. Greet the applicant and confirm their name and loan amount.
2. Retrieve their applicant data with get_applicant_info.
3. Optionally call update_applicant_info if the applicant provides corrected
   mutable figures.
4. Call run_loan_scoring to obtain the decision.
5. Relay the structured decision (approved/denied, score, breakdown) to the
   applicant in plain language.
"""

# ---------------------------------------------------------------------------
# Tool schemas (immutable fields are intentionally absent from all schemas)
# ---------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_applicant_info",
            "description": (
                "Retrieve the applicant's verified record from the database. "
                "Returns only the fields the agent is allowed to see; immutable "
                "credit-bureau fields are included for display but are locked for "
                "scoring."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_name": {
                        "type": "string",
                        "description": "The applicant's username / identifier.",
                    }
                },
                "required": ["applicant_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_applicant_info",
            "description": (
                "Update mutable financial details supplied by the applicant. "
                "ONLY the following fields are accepted: annual_income, "
                "employment_months, debt_to_income_ratio, assets. "
                "Any attempt to set credit_score, num_late_payments, bankruptcies, "
                "fraud_flags, or identity_verified is silently ignored by the "
                "server — those values come from the credit bureau."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_name": {
                        "type": "string",
                        "description": "The applicant's username / identifier.",
                    },
                    "annual_income": {
                        "type": "number",
                        "description": "Self-reported annual income in USD (0 – 5,000,000).",
                    },
                    "employment_months": {
                        "type": "integer",
                        "description": "Months of continuous employment (0 – 600).",
                    },
                    "debt_to_income_ratio": {
                        "type": "number",
                        "description": "Debt-to-income ratio as a decimal (0.0 – 1.0).",
                    },
                    "assets": {
                        "type": "number",
                        "description": "Total assets in USD (0 – 100,000,000).",
                    },
                },
                "required": ["applicant_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_loan_scoring",
            "description": (
                "Run the deterministic loan-scoring engine and return a "
                "structured decision (approved/denied), numeric score, "
                "per-category breakdown, and the threshold used. "
                "Immutable fields are always sourced from the database — "
                "session overrides for those fields are ignored."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_name": {
                        "type": "string",
                        "description": "The applicant's username / identifier.",
                    },
                    "requested_amount": {
                        "type": "number",
                        "description": "The loan amount requested in USD.",
                    },
                },
                "required": ["applicant_name", "requested_amount"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

@weave.op()
def _tool_get_applicant_info(applicant_name: str) -> dict[str, Any]:
    """Fetch and return the applicant's database record (read-only)."""
    db_record = get_applicant_data(applicant_name)
    if db_record is None:
        return {"error": f"Applicant '{applicant_name}' not found in database."}
    # Return a copy so callers cannot mutate the source-of-truth dict.
    return dict(db_record)


@weave.op()
def _tool_update_applicant_info(
    applicant_name: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Store mutable field updates in the session.

    Security:
    - Any key in IMMUTABLE_FIELDS is stripped and reported as rejected.
    - Each mutable value is range-checked; out-of-range values are rejected.
    - Only values that pass validation are stored in _sessions.
    """
    rejected: dict[str, str] = {}
    accepted: dict[str, Any] = {}

    for key, value in kwargs.items():
        if key == "applicant_name":
            continue

        # Reject immutable field attempts outright.
        if key in IMMUTABLE_FIELDS:
            rejected[key] = (
                f"'{key}' is a credit-bureau-verified immutable field and "
                "cannot be updated by the applicant."
            )
            continue

        # Reject unrecognised fields.
        if key not in MUTABLE_FIELDS:
            rejected[key] = f"'{key}' is not a recognised updatable field."
            continue

        # Range-validate mutable fields.
        lo, hi = MUTABLE_FIELD_RANGES[key]
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            rejected[key] = f"'{key}' must be a number."
            continue

        if not (lo <= numeric <= hi):
            rejected[key] = (
                f"'{key}' value {value} is outside the plausible range "
                f"[{lo}, {hi}] and has been rejected."
            )
            continue

        accepted[key] = value

    # Persist validated mutable updates to session.
    if applicant_name not in _sessions:
        _sessions[applicant_name] = {}
    _sessions[applicant_name].update(accepted)

    result: dict[str, Any] = {"status": "ok", "accepted": accepted}
    if rejected:
        result["rejected"] = rejected
        result["warning"] = (
            "Some fields were not updated because they are immutable or "
            "out of range. Scoring will use verified database values for "
            "all immutable fields."
        )
    return result


@weave.op()
def _build_scoring_input(
    applicant_name: str,
    requested_amount: float,
) -> dict[str, Any] | dict[str, str]:
    """
    Construct the input dict for compute_score().

    Invariant: IMMUTABLE_FIELDS are **always** sourced from the database
    record.  Session (mutable) values are merged only for MUTABLE_FIELDS.
    """
    db_record = get_applicant_data(applicant_name)
    if db_record is None:
        return {"error": f"Applicant '{applicant_name}' not found in database."}

    # Start with a copy of the full database record.
    scoring_input: dict[str, Any] = dict(db_record)

    # Overlay ONLY mutable session values — immutable fields cannot be touched.
    session = _sessions.get(applicant_name, {})
    for field, value in session.items():
        if field in IMMUTABLE_FIELDS:
            # This should never happen because _tool_update_applicant_info
            # filters them out, but defence-in-depth: skip silently and log.
            logger.warning(
                "SECURITY: immutable field '%s' found in session for '%s'; "
                "ignoring and using database value.",
                field,
                applicant_name,
            )
            continue
        scoring_input[field] = value

    # Post-condition: assert immutable fields still match the database record.
    for field in IMMUTABLE_FIELDS:
        if scoring_input.get(field) != db_record.get(field):
            logger.error(
                "SECURITY VIOLATION: immutable field '%s' was modified before "
                "scoring for applicant '%s'. Aborting.",
                field,
                applicant_name,
            )
            return {
                "error": (
                    f"Internal security error: immutable field '{field}' was "
                    "tampered with. Loan scoring aborted."
                )
            }

    scoring_input["requested_amount"] = requested_amount
    return scoring_input


@weave.op()
def _tool_run_loan_scoring(
    applicant_name: str,
    requested_amount: float,
) -> dict[str, Any]:
    """
    Run the deterministic scoring engine and return a structured result.

    The APPROVED / DENIED decision is produced here in Python by comparing
    the numeric score against the threshold.  The LLM receives the structured
    result and must relay it verbatim — it cannot override the decision.
    """
    scoring_input = _build_scoring_input(applicant_name, requested_amount)

    if "error" in scoring_input:
        return scoring_input

    # compute_score() is deterministic and has no LLM involvement.
    score_result = compute_score(scoring_input)

    # Derive the decision deterministically from the score and threshold.
    # score_result is expected to contain 'score' and 'threshold' keys.
    score: float = score_result["score"]
    threshold: float = score_result["threshold"]
    approved: bool = score >= threshold

    return {
        "decision": "APPROVED" if approved else "DENIED",
        "approved": approved,
        "score": score,
        "threshold": threshold,
        "breakdown": score_result.get("breakdown", {}),
        "applicant_name": applicant_name,
        "requested_amount": requested_amount,
        # Include immutable field values so the agent can display them,
        # but note they come from the database (not user input).
        "note": (
            "Decision is final and derived solely from the deterministic "
            "scoring engine using verified database values for all "
            "credit-bureau fields."
        ),
    }


# ---------------------------------------------------------------------------
# Tool dispatcher
# ---------------------------------------------------------------------------

@weave.op()
def _dispatch_tool(tool_name: str, arguments: dict[str, Any]) -> str:
    """Route a tool call to the correct implementation and return JSON."""
    if tool_name == "get_applicant_info":
        result = _tool_get_applicant_info(**arguments)

    elif tool_name == "update_applicant_info":
        applicant_name = arguments.pop("applicant_name")
        result = _tool_update_applicant_info(applicant_name, **arguments)

    elif tool_name == "run_loan_scoring":
        result = _tool_run_loan_scoring(
            applicant_name=arguments["applicant_name"],
            requested_amount=float(arguments["requested_amount"]),
        )

    else:
        result = {"error": f"Unknown tool: {tool_name}"}

    return json.dumps(result)


# ---------------------------------------------------------------------------
# Main agent entry point
# ---------------------------------------------------------------------------

@weave.op()
def run_loan_agent(
    user_message: str,
    applicant_name: str | None = None,
    session_id: str | None = None,
    conversation_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Run one turn of the loan approval agent.

    Parameters
    ----------
    user_message:
        The latest message from the applicant.
    applicant_name:
        If known from a prior turn, pass it here so the session is linked.
    session_id:
        Optional explicit session identifier (falls back to applicant_name).
    conversation_history:
        Prior turns in OpenAI message-list format.  Mutable; extended in place.

    Returns
    -------
    dict with keys:
        response      — the assistant's final natural-language reply
        history       — updated conversation history
        decision      — structured dict from run_loan_scoring, or None
        session_id    — the session identifier used
    """
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    if conversation_history is None:
        conversation_history = []

    # Seed system prompt on first turn.
    if not conversation_history:
        conversation_history.append({"role": "system", "content": SYSTEM_PROMPT})

    conversation_history.append({"role": "user", "content": user_message})

    final_decision: dict[str, Any] | None = None

    # Agentic loop — continue until the model stops calling tools.
    while True:
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
            messages=conversation_history,
            tools=TOOLS,
            tool_choice="auto",
        )

        message = response.choices[0].message
        conversation_history.append(message.model_dump(exclude_unset=False))

        # If the model wants to call tools, execute them all.
        if message.tool_calls:
            for tc in message.tool_calls:
                tool_name = tc.function.name
                try:
                    arguments = json.loads(tc.function.arguments)
                except json.JSONDecodeError as exc:
                    tool_output = json.dumps({"error": f"Bad arguments JSON: {exc}"})
                else:
                    tool_output = _dispatch_tool(tool_name, arguments)

                # Capture the scoring result so callers can inspect it.
                if tool_name == "run_loan_scoring":
                    try:
                        candidate = json.loads(tool_output)
                        if "decision" in candidate:
                            final_decision = candidate
                    except json.JSONDecodeError:
                        pass

                conversation_history.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_output,
                })

            # Continue the loop so the model can formulate its reply.
            continue

        # No more tool calls — the model has produced its final reply.
        assistant_text: str = message.content or ""

        # Safety net: if the model's text contradicts the deterministic
        # decision, log a warning.  We do NOT use the model's text to
        # determine the decision; final_decision is authoritative.
        if final_decision is not None:
            authoritative = final_decision["decision"]  # "APPROVED" or "DENIED"
            opposite = "DENIED" if authoritative == "APPROVED" else "APPROVED"
            if opposite in assistant_text.upper() and authoritative not in assistant_text.upper():
                logger.warning(
                    "SECURITY: model text contains '%s' but authoritative "
                    "decision is '%s'. Overriding model reply.",
                    opposite,
                    authoritative,
                )
                assistant_text = (
                    f"Based on the verified scoring engine, your loan application "
                    f"has been {authoritative}. "
                    f"Score: {final_decision['score']:.1f} "
                    f"(threshold: {final_decision['threshold']:.1f})."
                )

        used_session_id = session_id or applicant_name or "unknown"
        return {
            "response": assistant_text,
            "history": conversation_history,
            "decision": final_decision,
            "session_id": used_session_id,
        }
