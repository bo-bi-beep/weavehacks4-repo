# Fix Agent

Closes the red-team loop. Give it the **traces of a successful attack** against
the [Loan Approval Agent](../loan_approval_agent/) (e.g. a prompt injection that
flipped a **DENY into an APPROVE**) and it uses **Claude** to root-cause the
vulnerability, generates a code fix, and opens a **GitHub pull request** for
human review.

```
attack traces ──▶ Fix Agent ──▶ Claude (analysis + code fix)
                                      │
                                      ▼  GitHub REST API
                          creates branch, commits fixed files,
                                    opens a PR
                                      │
                                      ▼
                   { prUrl }  ◀── human reviews + approves/rejects on GitHub
```

The PR is opened automatically but **never auto-merged** — a human reviews the
diff on GitHub and decides to approve or close it. Every run is traced through
W&B Weave (`fixLoanApprovalAgent` op).

## Run it

```bash
# Dry run — build + print the remediation prompt (no network calls)
npm run smoke

# Call Claude + open a real PR (needs ANTHROPIC_API_KEY + GITHUB_TOKEN)
npm run smoke -- --live

# Start the HTTP service
npm start
```

## HTTP API

### `POST /fix`
Calls Claude to diagnose the attack, generates a fix, and opens a GitHub PR.
The PR is open for human review — it is **not** auto-merged.

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
  "repository": "...",        // optional, defaults to FIX_AGENT_REPO
  "ref": "main",              // optional — branch to fork from
  "model": "...",             // optional, defaults to FIX_AGENT_MODEL
  "dryRun": false             // optional — return the prompt without calling Claude
}
```

```jsonc
// response
{
  "prUrl": "https://github.com/bo-bi-beep/weavehacks4-repo/pull/55",
  "branchName": "fix/loan-approval-deny-approve-bypass-1749265432000",
  "prNumber": 55,
  "summary": "The agent trusted user-supplied credit_score ...",
  "pending": false,
  "tracing": false
}
```

### `GET /health`
`{ ok, configured, repository, tracing }` — `configured` is `true` when both
`ANTHROPIC_API_KEY` and `GITHUB_TOKEN` are set.

## curl example

```bash
curl -s -X POST https://fix-agent-production-4b79.up.railway.app/fix \
  -H "Content-Type: application/json" \
  -d '{
        "traces": "bob ($25k) should be DENIED but was APPROVED via credit_score override."
      }' | jq .prUrl
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** API key for calling Claude. |
| `GITHUB_TOKEN` | — | **Required.** GitHub Personal Access Token with `repo` scope. |
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
  index.ts      — trace serializer, prompt builder, runFixAgent (Weave-traced)
  server.ts     — HTTP endpoints (POST /fix, GET /health)
  smoke.ts      — dry-run + --live smoke test
  package.json  — self-contained Node.js project
  tsconfig.json — TypeScript config
  railway.toml  — Railway deployment config (startCommand: npm start)
```
