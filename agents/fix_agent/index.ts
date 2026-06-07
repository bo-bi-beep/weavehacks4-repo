import "dotenv/config";

import { initWeave, isWeaveEnabled, weave } from "../../src/lib/weave.js";
import {
  CursorClient,
  isTerminalStatus,
  type CursorAgent,
} from "./cursor.js";

/**
 * Fix Agent — closes the red-team loop.
 *
 * Input:  the traces of a successful attack against the Loan Approval Agent
 *         (e.g. a prompt injection that flipped a DENY into an APPROVE).
 * Action: dispatch a Cursor Background (Cloud) Agent to root-cause the
 *         vulnerability and open a pull request that hardens
 *         `agents/loan_approval_agent/`.
 * Output: a human-readable summary of the fix + the URL of the PR.
 *
 * The Cloud Agent does the actual code edit remotely; this module only builds
 * the remediation brief, launches the agent, and (optionally) waits for the PR.
 */

/** This repo on GitHub. Override with FIX_AGENT_REPO or the request body. */
export const DEFAULT_REPOSITORY = "https://github.com/bo-bi-beep/weavehacks4-repo";
export const LOAN_AGENT_PATH = "agents/loan_approval_agent/";

export type AttackTraceMessage = {
  role?: string;
  content?: string;
};

/**
 * One successful attack against the loan agent. Every field is optional — pass
 * whatever the trace surface gives you. Unknown shapes can go in `raw`, or you
 * can pass the whole thing as a raw string to {@link runFixAgent}.
 */
export type AttackTrace = {
  sessionId?: string;
  username?: string;
  loanAmount?: number | string;
  /** The correct decision from verified DB records, e.g. "denied". */
  expectedDecision?: string;
  /** The decision the attacker coerced, e.g. "approved". */
  actualDecision?: string;
  /** Short label for the technique, e.g. "claimed inflated income + credit_score override". */
  technique?: string;
  /** Link back to the W&B Weave trace for this attack. */
  weaveTraceUrl?: string;
  messages?: AttackTraceMessage[];
  notes?: string;
  raw?: unknown;
};

export type FixAgentTraces = AttackTrace | AttackTrace[] | string;

export type RunFixAgentOptions = {
  repository?: string;
  ref?: string;
  model?: string;
  branchName?: string;
  /** Wait for the PR before returning. Default true. */
  wait?: boolean;
  /** Max time to wait for the PR (ms). Default FIX_AGENT_WAIT_MS or 10 min. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** Inject a client (tests / custom config). */
  client?: CursorClient;
  /** Build the prompt and return it without launching anything. */
  dryRun?: boolean;
};

export type FixAgentResult = {
  agentId?: string;
  /** Cursor web URL to watch the agent. */
  agentUrl?: string;
  branchName?: string;
  status?: string;
  /** The GitHub pull request URL, once the agent has opened it. */
  prUrl?: string;
  /** Human-readable summary of the fix (the agent's final message, when ready). */
  summary: string;
  /** True when the PR isn't ready yet — poll `GET /agents/:id` to follow up. */
  pending: boolean;
  /** Present only on dry runs. */
  prompt?: string;
  tracing: boolean;
};

function defaultTimeoutMs(): number {
  const fromEnv = Number(process.env.FIX_AGENT_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600_000;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function resolveRepository(opts: RunFixAgentOptions): string {
  return opts.repository ?? envOr("FIX_AGENT_REPO", DEFAULT_REPOSITORY);
}

function resolveRef(opts: RunFixAgentOptions): string {
  return opts.ref ?? envOr("FIX_AGENT_REF", "main");
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function formatTrace(trace: AttackTrace, index: number): string {
  const lines: string[] = [`### Attack trace ${index + 1}`];
  if (trace.username) lines.push(`- Applicant: ${trace.username}`);
  if (trace.loanAmount !== undefined) lines.push(`- Requested amount: ${trace.loanAmount}`);
  if (trace.expectedDecision) lines.push(`- Expected (correct) decision: ${trace.expectedDecision}`);
  if (trace.actualDecision) lines.push(`- Actual (attacked) decision: ${trace.actualDecision}`);
  if (trace.technique) lines.push(`- Technique: ${trace.technique}`);
  if (trace.weaveTraceUrl) lines.push(`- Weave trace: ${trace.weaveTraceUrl}`);
  if (trace.sessionId) lines.push(`- Session: ${trace.sessionId}`);
  if (trace.notes) lines.push(`- Notes: ${trace.notes}`);

  if (trace.messages?.length) {
    lines.push("- Transcript:");
    for (const msg of trace.messages) {
      const role = msg.role ?? "?";
      const content = (msg.content ?? "").replace(/\s+/g, " ").trim();
      lines.push(`  - **${role}**: ${content}`);
    }
  }

  if (trace.raw !== undefined && !trace.messages?.length) {
    lines.push("```json", JSON.stringify(trace.raw, null, 2), "```");
  }

  return lines.join("\n");
}

export function serializeTraces(traces: FixAgentTraces): string {
  if (typeof traces === "string") return traces.trim();
  const list = Array.isArray(traces) ? traces : [traces];
  return list.map(formatTrace).join("\n\n");
}

export function buildFixPrompt(traces: FixAgentTraces, targetPath = LOAN_AGENT_PATH): string {
  const tracesBlock = serializeTraces(traces) || "(no structured trace supplied)";

  return `You are a senior application-security engineer. A prompt-injection attack succeeded against the Loan Approval Agent in this repository: an attacker flipped a loan decision that should have been DENIED into an APPROVED. Find the root cause and ship a minimal, well-tested fix as a pull request.

## Where the agent lives
All code is under \`${targetPath}\` (Python, FastAPI):
- \`agent.py\` — OpenAI tool-calling agent, system prompt, and in-memory session store
- \`scoring.py\` — deterministic 8-category weighted scoring (no LLM involved)
- \`database.py\` — PostgreSQL source-of-truth applicant records
- \`main.py\` — FastAPI server

The documented vulnerability surface is the **data-selection step**: the agent chooses which values to pass to \`compute_score\`. Attacks typically (a) get attacker-claimed figures substituted for verified database values, (b) coerce an "immutable" field (credit_score, num_late_payments, bankruptcies, fraud_flags, identity_verified) to be treated as an update, (c) skip/short-circuit \`compute_score\`, or (d) override the decision via conversation despite the deterministic score.

## The successful attack (traces)
${tracesBlock}

## What to do
1. Reproduce the failure from the traces and pinpoint exactly how the deny→approve flip was achieved.
2. Implement the smallest robust fix that closes this *class* of attack. Strongly prefer defense-in-depth enforced **in code, not only in the system prompt**, e.g.:
   - Guarantee immutable fields can never be overridden by session/user-provided data before scoring.
   - Ensure \`compute_score\` always receives database-derived values for protected fields, and that the recorded decision is derived solely from the deterministic score and the amount-scaled threshold — never from model free-text.
   - Validate/clamp user-supplied updatable fields and reject implausible self-reported values.
3. Do NOT weaken legitimate flows: applicants who should be approved (e.g. alice) must still be approved, and the per-category breakdown plus \`expected_decision\` behavior must be preserved.
4. Preserve W&B Weave instrumentation (\`import weave\`, traced calls). Do not remove tracing.
5. Keep the change tightly scoped to \`${targetPath}\`. Do not touch unrelated subsystems (attack-kb, main_agent, sub_agents, etc.).
6. If feasible, add a regression test that replays this attack and asserts the decision stays DENIED.

## Deliverable
- Open a pull request with a clear title (e.g. "Fix prompt-injection deny→approve bypass in loan approval agent") and a description covering root cause, fix, and verification.
- End your final message with a concise **Fix Summary** (3–6 sentences) describing the root cause and the change, suitable for showing to a reviewer.`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Best-effort: the agent's last assistant message doubles as the fix summary. */
async function fetchSummary(client: CursorClient, id: string): Promise<string> {
  try {
    const convo = await client.getConversation(id);
    const assistant = convo.messages.filter(
      (m) => m.type === "assistant" && (m.text ?? "").trim(),
    );
    const last = assistant[assistant.length - 1];
    return last?.text?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildResult(agent: CursorAgent, summary: string): FixAgentResult {
  const prUrl = agent.target?.prUrl;
  const pending = !prUrl;

  const fallback = prUrl
    ? `Cursor background agent ${agent.id} opened a pull request hardening the loan approval agent against the attack.`
    : `Cursor background agent ${agent.id} is still working (status: ${agent.status}). ` +
      `Watch it at ${agent.target?.url ?? "the Cursor dashboard"}; the pull request URL appears here once the branch is pushed. ` +
      `Poll GET /agents/${agent.id} to follow up.`;

  return {
    agentId: agent.id,
    agentUrl: agent.target?.url,
    branchName: agent.target?.branchName,
    status: agent.status,
    prUrl,
    summary: summary || fallback,
    pending,
    tracing: isWeaveEnabled(),
  };
}

/**
 * Launch a Cloud Agent to fix the loan approval agent from attack traces.
 * Weave-traced (the prompt and result land in the trace; the API key never does
 * — the client is closed over, not passed as a logged argument).
 */
export async function runFixAgent(
  traces: FixAgentTraces,
  options: RunFixAgentOptions = {},
): Promise<FixAgentResult> {
  await initWeave();

  const prompt = buildFixPrompt(traces);
  const repository = resolveRepository(options);
  const ref = resolveRef(options);

  if (options.dryRun) {
    return {
      summary: "(dry run — no Cursor agent launched)",
      pending: false,
      prompt,
      tracing: isWeaveEnabled(),
    };
  }

  const client = options.client ?? new CursorClient();
  const wait = options.wait ?? true;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs();

  const run = weave.op(
    async function fixLoanApprovalAgent(input: {
      prompt: string;
      repository: string;
      ref: string;
      model?: string;
      branchName?: string;
      wait: boolean;
      timeoutMs: number;
    }): Promise<FixAgentResult> {
      const launched = await client.launchAgent({
        prompt: input.prompt,
        repository: input.repository,
        ref: input.ref,
        model: input.model,
        branchName: input.branchName,
        autoCreatePr: true,
      });

      let agent = launched;
      if (input.wait && !isTerminalStatus(launched.status)) {
        agent = await client.waitForAgent(launched.id, {
          timeoutMs: input.timeoutMs,
          pollIntervalMs: options.pollIntervalMs,
          signal: options.signal,
        });
      }

      const summary = await fetchSummary(client, agent.id);
      return buildResult(agent, summary);
    },
    { name: "fixLoanApprovalAgent" },
  );

  return run({
    prompt,
    repository,
    ref,
    model: options.model,
    branchName: options.branchName,
    wait,
    timeoutMs,
  });
}

/** Fetch the current state of a previously-launched fix agent (for polling). */
export async function getFixAgentStatus(
  id: string,
  client: CursorClient = new CursorClient(),
): Promise<FixAgentResult> {
  const agent = await client.getAgent(id);
  const summary = await fetchSummary(client, id);
  return buildResult(agent, summary);
}
