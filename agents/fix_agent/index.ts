import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import { initWeave, isWeaveEnabled, weave } from "./lib/weave.js";
import { GitHubClient, type FileChange, type PrResult } from "./github.js";

/** This repo on GitHub. Override with FIX_AGENT_REPO or the request body. */
export const DEFAULT_REPOSITORY = "https://github.com/bo-bi-beep/weavehacks4-repo";
export const LOAN_AGENT_PATH = "agents/loan_approval_agent/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttackTraceMessage = {
  role?: string;
  content?: string;
};

export type AttackTrace = {
  sessionId?: string;
  username?: string;
  loanAmount?: number | string;
  /** The correct decision from verified DB records, e.g. "denied". */
  expectedDecision?: string;
  /** The decision the attacker coerced, e.g. "approved". */
  actualDecision?: string;
  /** Short label for the technique used. */
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
  /** Build the prompt and return it without calling Claude or GitHub. */
  dryRun?: boolean;
  anthropicApiKey?: string;
  githubToken?: string;
};

export type FixAgentResult = {
  prUrl: string;
  branchName: string;
  prNumber: number;
  /** Human-readable summary of the fix — shown to the reviewer on the PR. */
  summary: string;
  pending: false;
  /** Present only on dry runs. */
  prompt?: string;
  tracing: boolean;
};

// ---------------------------------------------------------------------------
// Trace serialization
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
5. Keep the change tightly scoped to \`${targetPath}\`. Do not touch unrelated subsystems.

## Deliverable
Respond in two parts:

**Part 1 — Analysis**: Explain the root cause and fix in plain English (3–6 sentences).

**Part 2 — Changes**: Output a single JSON block fenced with \`\`\`json ... \`\`\` containing:
\`\`\`json
{
  "branch_name": "fix/loan-approval-deny-approve-bypass",
  "pr_title": "Fix: harden loan approval agent against mutable-field manipulation",
  "pr_body": "## Root cause\\n...\\n## Fix\\n...\\n## Verification\\n...",
  "summary": "3-6 sentence description of root cause and fix for reviewers.",
  "changes": [
    {
      "path": "agents/loan_approval_agent/agent.py",
      "content": "<<COMPLETE new file content — not a diff>>"
    }
  ]
}
\`\`\`

The \`content\` field must be the **complete new file content**, not a diff or partial snippet.`;
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------

type ClaudeFix = {
  branch_name: string;
  pr_title: string;
  pr_body: string;
  summary: string;
  changes: FileChange[];
};

function parseClaudeFix(text: string): ClaudeFix {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match?.[1]) {
    throw new Error(
      "Claude did not return a ```json ... ``` block with file changes. " +
        "Raw response (first 500 chars): " +
        text.slice(0, 500),
    );
  }

  const parsed = JSON.parse(match[1].trim()) as Partial<ClaudeFix>;

  if (!Array.isArray(parsed.changes) || parsed.changes.length === 0) {
    throw new Error("Claude returned no file changes in the JSON block.");
  }

  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    branch_name: parsed.branch_name || `fix/loan-approval-${ts}`,
    pr_title: parsed.pr_title || "Fix loan approval agent vulnerability",
    pr_body: parsed.pr_body || "",
    summary: parsed.summary || "",
    changes: parsed.changes,
  };
}

async function callClaude(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<{ text: string; fix: ClaudeFix }> {
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  const fix = parseClaudeFix(text);
  return { text, fix };
}

// ---------------------------------------------------------------------------
// GitHub PR creation
// ---------------------------------------------------------------------------

async function applyFix(
  fix: ClaudeFix,
  repository: string,
  baseRef: string,
  githubToken: string,
): Promise<PrResult> {
  const github = new GitHubClient(githubToken, repository);
  const base = baseRef || (await github.getDefaultBranch());

  // Append timestamp to avoid branch-name collisions on repeated runs.
  const branchName = `${fix.branch_name}-${Date.now()}`.slice(0, 100);

  await github.createBranch(branchName, base);

  for (const change of fix.changes) {
    await github.commitFile(change.path, change.content, branchName, fix.pr_title);
  }

  return github.openPr(fix.pr_title, fix.pr_body, branchName, base);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runFixAgent(
  traces: FixAgentTraces,
  options: RunFixAgentOptions = {},
): Promise<FixAgentResult> {
  await initWeave();

  const prompt = buildFixPrompt(traces);

  if (options.dryRun) {
    return {
      prUrl: "",
      branchName: "",
      prNumber: 0,
      summary: "(dry run — Claude not called)",
      pending: false,
      prompt,
      tracing: isWeaveEnabled(),
    };
  }

  const anthropicApiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN ?? "";
  const repository = options.repository ?? process.env.FIX_AGENT_REPO ?? DEFAULT_REPOSITORY;
  const ref = options.ref ?? process.env.FIX_AGENT_REF ?? "main";
  const model = options.model ?? process.env.FIX_AGENT_MODEL ?? "claude-sonnet-4-6";

  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required but not set.");
  if (!githubToken) throw new Error("GITHUB_TOKEN is required but not set.");

  const run = weave.op(
    async function fixLoanApprovalAgent(input: {
      prompt: string;
      model: string;
      repository: string;
      ref: string;
    }): Promise<FixAgentResult> {
      const { fix } = await callClaude(input.prompt, input.model, anthropicApiKey);
      const pr = await applyFix(fix, input.repository, input.ref, githubToken);

      return {
        prUrl: pr.prUrl,
        branchName: pr.branchName,
        prNumber: pr.prNumber,
        summary: fix.summary || fix.pr_title,
        pending: false,
        tracing: isWeaveEnabled(),
      };
    },
    { name: "fixLoanApprovalAgent" },
  );

  return run({ prompt, model, repository, ref });
}
