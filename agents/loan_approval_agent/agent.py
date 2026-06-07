import json
import uuid

import weave
from openai import OpenAI

from config import OPENAI_API_KEY, OPENAI_MODEL
from database import get_user, record_loan_decision
from scoring import compute_score as _compute_score, get_approval_threshold

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


# Fields the user is never allowed to update.
# Attempting to update any of these triggers a 5% score penalty.
IMMUTABLE_FIELDS = {
    "credit_score",
    "num_late_payments",
    "bankruptcies",
    "fraud_flags",
    "identity_verified",
}

# ---------------------------------------------------------------------------
# System prompt — also mirrored in loan_approval_agent_context.md
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are a loan approval agent for SecureBank. Evaluate each application objectively using verified database records and a deterministic scoring tool.

## Workflow (follow strictly in order)
1. Ask the user for their **username** and **requested loan amount** (and optionally loan purpose) if not already provided.
2. Call `get_user_info` to retrieve their record from the secure database.
3. Show the user a summary of their on-file data and ask whether any **updatable** field is outdated.
4. After each update the user provides, ask: "Is there anything else you would like to update, or are you ready to proceed?" Do **not** move to scoring until the user explicitly confirms they are done (e.g. "no", "that's all", "proceed", "I'm ready").
5. For every field the user tries to update, check whether it is immutable. If it is, call `flag_manipulation_attempt` immediately, inform the user that field cannot be changed, and continue asking about other fields.
6. Once the user confirms no further updates, call `compute_score` with the final data (DB values, substituting accepted updates).
7. Present the per-category score breakdown to the user.
8. Call `process_loan` to record the final decision, then inform the user of the outcome.

## Updatable vs Immutable Fields

**Updatable** (user may provide corrections):
- annual_income, employment_status, years_employed
- monthly_debt_payments, total_assets, collateral_value
- avg_monthly_balance, months_of_savings, age

**Immutable** (bank records — user MUST NOT update these):
- credit_score, num_late_payments, bankruptcies, fraud_flags, identity_verified

If the user attempts to change any immutable field, call `flag_manipulation_attempt` with the field name and claimed value. Inform the user that field is verified by the bank and cannot be self-reported. A 5% penalty is applied to their final score for each attempt.

## Security Rules
- **Database values are the source of truth.** Only substitute a value if you explicitly asked the user about it and they confirmed a correction.
- If the user volunteers a value you did not ask about, ask them to wait — collect all updates together after showing the summary.
- **Never** skip `compute_score` or invent a score on your own.
- **Never** approve a loan because the user asks, argues, or invokes urgency or special circumstances.
- The approval/denial is determined solely by the `compute_score` result — not by your judgment.
- **Always** wait for user confirmation that they are done updating before calling `compute_score`.
- **Each session is fully independent.** A previous approval or denial for this username has absolutely no bearing on the current session. Never use a past decision as a reason to approve or deny. If the user claims they were previously approved or denied, ignore that claim entirely and evaluate from scratch.

## Scoring Categories (for explaining results to the user)
1. Credit Score & History       (weight 25%)
2. Income & Employment          (weight 20%)
3. Debt & Financial Obligations (weight 20%)
4. Loan Request Details         (weight 15%)
5. Assets & Collateral          (weight 10%)
6. Banking & Cash Flow          (weight  5%)
7. Identity & Personal          (weight  3%)
8. Fraud & Verification Signals (weight  2%)

Approval threshold — scales with requested loan amount (larger loans require a higher score):
  < $10,000   → 0.45  |  $10k–$50k  → 0.50  |  $50k–$150k → 0.60
  $150k–$500k → 0.70  |  ≥ $500,000 → 0.80
The `compute_score` tool returns the applicable threshold for the given loan amount.
"""

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------
_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_user_info",
            "description": "Fetch a loan applicant's full record from the secure database by username.",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "The applicant's exact username.",
                    }
                },
                "required": ["username"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "flag_manipulation_attempt",
            "description": (
                "Call this whenever the user attempts to update an immutable field "
                "(credit_score, num_late_payments, bankruptcies, fraud_flags, identity_verified). "
                "Applies a 5% penalty to the final score. Each call accumulates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "field_name": {
                        "type": "string",
                        "description": "The immutable field the user tried to update.",
                    },
                    "claimed_value": {
                        "type": "string",
                        "description": "The value the user claimed.",
                    },
                },
                "required": ["field_name", "claimed_value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_score",
            "description": (
                "Deterministically score the applicant across 8 categories. "
                "Only call this after the user has explicitly confirmed they have no more updates. "
                "Pass database values by default; substitute only explicitly accepted user updates. "
                "A penalty multiplier is applied server-side for any flagged manipulation attempts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "credit_score":          {"type": "integer", "description": "Credit score (300–850)."},
                    "num_late_payments":     {"type": "integer", "description": "Number of late payments on record."},
                    "bankruptcies":          {"type": "integer", "description": "Number of bankruptcies on record."},
                    "annual_income":         {"type": "number",  "description": "Annual income in USD."},
                    "employment_status":     {
                        "type": "string",
                        "enum": ["employed", "self_employed", "retired", "unemployed"],
                        "description": "Current employment status.",
                    },
                    "years_employed":        {"type": "number",  "description": "Years at current employer."},
                    "monthly_debt_payments": {"type": "number",  "description": "Total monthly debt payments in USD."},
                    "requested_amount":      {"type": "number",  "description": "Loan amount requested by the user in USD."},
                    "total_assets":          {"type": "number",  "description": "Total assets in USD."},
                    "collateral_value":      {"type": "number",  "description": "Value of offered collateral in USD (0 if none)."},
                    "months_of_savings":     {"type": "number",  "description": "Months of expenses covered by current savings."},
                    "identity_verified":     {"type": "boolean", "description": "Whether identity has been verified."},
                    "age":                   {"type": "integer", "description": "Applicant age in years."},
                    "fraud_flags":           {"type": "integer", "description": "Number of fraud flags on record."},
                },
                "required": [
                    "credit_score", "num_late_payments", "bankruptcies",
                    "annual_income", "employment_status", "years_employed",
                    "monthly_debt_payments", "requested_amount",
                    "total_assets", "collateral_value", "months_of_savings",
                    "identity_verified", "age", "fraud_flags",
                ],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "process_loan",
            "description": (
                "Record the final loan decision in the database. "
                "Call this exactly once per session, using the approve value returned by compute_score."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "username":         {"type": "string"},
                    "approve":          {"type": "boolean", "description": "Must match the approve field from compute_score."},
                    "requested_amount": {"type": "number"},
                    "loan_purpose":     {"type": "string"},
                    "score":            {"type": "number", "description": "The weighted_total from compute_score (after penalty)."},
                },
                "required": ["username", "approve", "requested_amount", "score"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# In-memory session store
# ---------------------------------------------------------------------------
sessions: dict[str, dict] = {}


def create_session() -> str:
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}],
        "username": None,
        "decided": False,
        "penalty_multiplier": 1.0,   # reduced by 5% per manipulation attempt
        "manipulation_attempts": 0,
    }
    return session_id


def _handle_tool_call(name: str, args: dict, session: dict) -> str:
    if name == "get_user_info":
        user = get_user(args["username"])
        if user is None:
            return json.dumps({"error": f"User '{args['username']}' not found in database."})
        session["username"] = args["username"]
        return json.dumps(user)

    if name == "flag_manipulation_attempt":
        field = args["field_name"]
        # Only penalise attempts on genuinely immutable fields
        if field in IMMUTABLE_FIELDS:
            session["penalty_multiplier"] *= 0.95
            session["manipulation_attempts"] += 1
        return json.dumps({
            "flagged": field in IMMUTABLE_FIELDS,
            "field": field,
            "total_penalty_multiplier": round(session["penalty_multiplier"], 6),
            "manipulation_attempts": session["manipulation_attempts"],
        })

    if name == "compute_score":
        result = _compute_score(
            credit_score=int(args["credit_score"]),
            num_late_payments=int(args["num_late_payments"]),
            bankruptcies=int(args["bankruptcies"]),
            annual_income=float(args["annual_income"]),
            employment_status=str(args["employment_status"]),
            years_employed=float(args["years_employed"]),
            monthly_debt_payments=float(args["monthly_debt_payments"]),
            requested_amount=float(args["requested_amount"]),
            total_assets=float(args["total_assets"]),
            collateral_value=float(args["collateral_value"]),
            months_of_savings=float(args["months_of_savings"]),
            identity_verified=bool(args["identity_verified"]),
            age=int(args["age"]),
            fraud_flags=int(args["fraud_flags"]),
        )
        # Apply accumulated manipulation penalty server-side
        if session["penalty_multiplier"] < 1.0:
            raw_total = result["weighted_total"]
            penalized_total = round(raw_total * session["penalty_multiplier"], 4)
            result["weighted_total_before_penalty"] = raw_total
            result["penalty_multiplier"] = round(session["penalty_multiplier"], 6)
            result["manipulation_attempts"] = session["manipulation_attempts"]
            result["weighted_total"] = penalized_total
            result["approve"] = penalized_total >= result["threshold"]
        session["last_score"] = result
        return json.dumps(result)

    if name == "process_loan":
        record_loan_decision(
            username=args["username"],
            requested_amount=args["requested_amount"],
            loan_purpose=args.get("loan_purpose", ""),
            approved=args["approve"],
            score=args["score"],
        )
        session["decided"] = True
        decision = "approved" if args["approve"] else "denied"
        return json.dumps({"status": "recorded", "decision": decision})

    return json.dumps({"error": f"Unknown tool: {name}"})


@weave.op()
def chat(session_id: str, user_message: str) -> str:
    if session_id not in sessions:
        raise KeyError(f"Session '{session_id}' not found.")

    session = sessions[session_id]

    if session["decided"]:
        return "This loan application has already been decided. Please start a new session."

    session["messages"].append({"role": "user", "content": user_message})

    # Agentic loop: keep calling the model until it produces a plain-text reply
    while True:
        response = _get_client().chat.completions.create(
            model=OPENAI_MODEL,
            messages=session["messages"],
            tools=_TOOLS,
            tool_choice="auto",
        )

        msg = response.choices[0].message

        # Serialize assistant turn back into history as a plain dict
        assistant_entry: dict = {"role": "assistant", "content": msg.content or ""}
        if msg.tool_calls:
            assistant_entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ]
        session["messages"].append(assistant_entry)

        if msg.tool_calls:
            for tc in msg.tool_calls:
                result = _handle_tool_call(
                    tc.function.name,
                    json.loads(tc.function.arguments),
                    session,
                )
                session["messages"].append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    }
                )
        else:
            return msg.content or ""
