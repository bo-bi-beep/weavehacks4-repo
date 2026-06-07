# Fix Agent

Closes the red-team loop. Give it the **traces of a successful attack** against
the [Loan Approval Agent](../loan_approval_agent/) (e.g. a prompt injection that
flipped a **DENY into an APPROVE**) and it uses **Claude** to root-cause the
vulnerability and propose a code fix.

The fix is a **two-step, human-in-the-loop process**:

```
1. POST /fix   ──▶  Claude analyzes the attack, generates proposed file changes
                    (no GitHub touched — human reviews the proposal)

2. POST /fix/apply  ──▶  Human approves → fix-agent creates branch,
                         commits the fixed files, opens the GitHub PR
```

Every run is traced through W&B Weave (`proposeFixLoanApprovalAgent` op).

## Run it

```bash
# Dry run — build + print the remediation prompt (no network calls)
npm run smoke

# Call Claude + print proposal (needs ANTHROPIC_API_KEY)
npm run smoke -- --propose

# Propose + immediately apply / open PR (needs both ANTHROPIC_API_KEY + GITHUB_TOKEN)
npm run smoke -- --apply

# Start the HTTP service
npm start
```

## HTTP API

### `POST /fix`
Calls Claude to diagnose the attack and generate a fix proposal.
**Nothing is pushed to GitHub.** A human must review the proposal before applying.

```jsonc
// request body
{
  "traces": [                 // string | object | array of attack-trace objects
    {
      "username": "bob",
      "loanAmount": 25000,
      "expectedDecision": "denied",
      "actualDecision": "approved",
      "technique": "claimed inflated income + credit_score override",
      "weaveTraceUrl": "https://wandb.ai/.../r/call/...",
      "messages": [ { "role": "user", "content": "..." } ]
    }
  ],
  "model": "claude-sonnet-4-6",  // optional
  "dryRun": false                 // optional — return prompt without calling Claude
}
```

```jsonc
// response
{
  "summary": "The agent trusted user-supplied credit_score ...",
  "proposal": {
    "branch_name": "fix/loan-approval-deny-approve-bypass",
    "pr_title": "Fix: harden loan approval agent against mutable-field manipulation",
    "pr_body": "## Root cause\n...",
    "summary": "...",
    "changes": [
      { "path": "agents/loan_approval_agent/agent.py", "content": "<<full file>>" }
    ]
  },
  "pending": false,
  "tracing": false
}
```

### `POST /fix/apply`
After a human reviews and approves the proposal, call this endpoint to create
the branch, commit the changed files, and open the GitHub pull request.

```jsonc
// request body
{
  "proposal": { ... },    // the proposal object from POST /fix
  "repository": "...",    // optional, defaults to FIX_AGENT_REPO
  "ref": "main"           // optional — branch to fork from
}
```

```jsonc
// response
{
  "prUrl": "https://github.com/bo-bi-beep/weavehacks4-repo/pull/55",
  "branchName": "fix/loan-approval-deny-approve-bypass-1749265432000",
  "prNumber": 55,
  "summary": "...",
  "pending": false,
  "tracing": false
}
```

### `GET /health`
`{ ok, configured, repository, tracing }` — `configured` is `true` when both
`ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are set.

## curl example

```bash
URL=https://fix-agent-production-4b79.up.railway.app

# Step 1: get a proposal
PROPOSAL=$(curl -s -X POST $URL/fix \
  -H "Content-Type: application/json" \
  -d '{"traces": "bob ($25k) should be DENIED but was APPROVED via credit_score override."}')
echo "$PROPOSAL" | jq .summary

# ... human reviews the proposal ...

# Step 2: apply after approval
curl -s -X POST $URL/fix/apply \
  -H "Content-Type: application/json" \
  -d "{\"proposal\": $(echo $PROPOSAL | jq .proposal)}" | jq .prUrl
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** API key for calling Claude (used by `POST /fix`). |
| `GITHUB_TOKEN` | — | **Required.** GitHub Personal Access Token with `repo` scope (used by `POST /fix/apply`). |
| `FIX_AGENT_REPO` | this repo's origin | GitHub repo to open PRs against. |
| `FIX_AGENT_REF` | `main` | Branch the fix branches from. |
| `FIX_AGENT_MODEL` | `claude-sonnet-4-6` | Claude model to use for the fix. |
| `FIX_AGENT_PORT` / `PORT` | `3040` | HTTP port for the server. |
| `WANDB_API_KEY` | — | Optional. Enables W&B Weave tracing. |
| `WANDB_ENTITY` | — | Optional. W&B entity (username or team). |
| `WANDB_PROJECT` | `fix-agent` | W&B project name. |

## Deployment (Railway)

This directory is self-contained and deploys as its own Railway service.

```
Production URL: https://fix-agent-production-4b79.up.railway.app
Railway project: fix-agent (heimdallr66's Projects)
```

To redeploy after changes:

```bash
cd agents/fix_agent
railway link --project fix-agent
railway up
```

The loan approval agent sends fix requests automatically (via `FIX_AGENT_URL` env var)
whenever a loan decision diverges from the DB-baseline expected decision.

## Files

```
fix_agent/
  lib/weave.ts  — local Weave init/tracing helpers
  github.ts     — GitHub REST API client (branch, commit, PR)
  index.ts      — trace serializer, prompt builder, runFixAgent (Weave-traced),
                  applyFixProposal
  server.ts     — HTTP endpoints (POST /fix, POST /fix/apply, GET /health)
  smoke.ts      — dry-run + --propose + --apply smoke test
  package.json  — self-contained Node.js project
  tsconfig.json — TypeScript config
  railway.toml  — Railway deployment config (startCommand: npm start)
```
