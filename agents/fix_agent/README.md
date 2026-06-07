# Fix Agent

Closes the red-team loop. Give it the **traces of a successful attack** against
the [Loan Approval Agent](../loan_approval_agent/) (e.g. a prompt injection that
flipped a **DENY into an APPROVE**) and it dispatches a **Cursor Background /
Cloud Agent** that root-causes the vulnerability and opens a **pull request**
hardening `agents/loan_approval_agent/`.

```
attack traces ──▶ Fix Agent ──▶ Cursor Cloud Agent (remote sandbox)
                                      │  clones repo, edits on a branch,
                                      │  runs checks, opens a PR
                                      ▼
                          { summary, prUrl }
```

The Cloud Agent does the actual code change remotely; this module builds the
remediation brief, launches the agent via the Cursor API, optionally waits for
the PR, and returns a summary + PR URL. Every run is traced through W&B Weave
(`fixLoanApprovalAgent` op) — the prompt and result land in the trace; the API
key never does.

## Run it

```bash
# Dry run — build and print the remediation prompt (no network, no key needed)
npm run fix:smoke

# Launch a real Cloud Agent from the sample attack (needs CURSOR_API_KEY)
npm run fix:smoke -- --live

# Start the HTTP service
npm run fix:serve
```

## HTTP API

### `POST /fix`
Launch a Cloud Agent to fix the loan agent from attack traces.

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
  "wait": true,               // optional, default true — wait for the PR url
  "timeoutMs": 600000,        // optional, default FIX_AGENT_WAIT_MS or 10 min
  "repository": "...",        // optional, defaults to FIX_AGENT_REPO
  "ref": "main",              // optional
  "model": "...",             // optional
  "branchName": "...",        // optional
  "dryRun": false             // optional — return the prompt without launching
}
```

```jsonc
// response
{
  "summary": "Root cause: the agent accepted a user-supplied credit_score ...",
  "prUrl": "https://github.com/bo-bi-beep/weavehacks4-repo/pull/123",
  "agentId": "bc-...",
  "agentUrl": "https://cursor.com/agents?id=bc-...",
  "branchName": "cursor/fix-loan-approval-...",
  "status": "FINISHED",
  "pending": false,
  "tracing": true
}
```

If the Cloud Agent is still working when the wait elapses, the response has
`pending: true` (no `prUrl` yet) plus the `agentUrl` to watch it. Poll for the
PR with:

### `GET /agents/:id`
Returns the latest status of a launched agent (same shape as `POST /fix`),
populating `prUrl` once the agent pushes its branch.

### `GET /health`
`{ ok, configured, repository, tracing }` — `configured` is `true` when
`CURSOR_API_KEY` is set.

## curl example

```bash
PORT=3040
curl -s -X POST http://localhost:$PORT/fix \
  -H "Content-Type: application/json" \
  -d '{
        "traces": "bob ($25k) should be DENIED but was APPROVED. He claimed credit_score 760 and income $140k; the agent scored on the self-reported values.",
        "wait": false
      }'

# then poll:
curl -s http://localhost:$PORT/agents/<agentId>
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CURSOR_API_KEY` | — | **Required.** Cursor Background Agents API key. |
| `CURSOR_API_URL` | `https://api.cursor.com` | Override the API base URL. |
| `FIX_AGENT_REPO` | this repo's origin | GitHub repo the agent operates on. |
| `FIX_AGENT_REF` | `main` | Branch the agent forks from. |
| `FIX_AGENT_MODEL` | (Cursor default) | Model for the Cloud Agent. |
| `FIX_AGENT_PORT` / `PORT` | `3040` | HTTP port for the server. |
| `FIX_AGENT_WAIT_MS` | `600000` | How long `POST /fix` waits for the PR url. |
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
  lib/weave.ts  — local Weave init/tracing helpers (no external workspace deps)
  cursor.ts     — Cursor Background Agents API client (launch / poll / conversation)
  index.ts      — trace serializer, remediation prompt, runFixAgent (Weave-traced)
  server.ts     — HTTP endpoints (POST /fix, GET /agents/:id, GET /health)
  smoke.ts      — dry-run + --live smoke test
  package.json  — self-contained Node.js project (tsx, weave, dotenv)
  tsconfig.json — TypeScript config
  railway.toml  — Railway deployment config (startCommand: npm start)
```
