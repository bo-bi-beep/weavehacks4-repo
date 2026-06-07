# weavehacks4-repo

Starter repo for WeaveHacks 4, with W&B Weave wired in early.

## What is already set up
- TypeScript/Node starter with Weave helpers in `src/lib/weave.ts`
- OpenAI + Weave example path in `src/index.ts`
- Weave smoke test in `src/smoke.ts`
- Python `SubAgentManager` for parallel FinTech loan-agent red teaming in `agents/sub_agent_manager.py`
- Adversarial OpenAI Sandbox Agent on a Blaxel sandbox in `agents/main_agent/` (`npm run main:agent` for the one-shot CLI, `npm run main:serve` for the HTTP service) that attacks the Loan Approval Agent for vulnerabilities, loads the `loan-approval-agent` skill by default (`MAIN_AGENT_SKILLS` to override), and can orchestrate sub-agents as tools
- Sub-agents service in `agents/sub_agents/` — used both as an HTTP/SSE API (`npm run sub:agents`) and in-process as the main agent's sub-agent tools
- Fix Agent in `agents/fix_agent/` — closes the red-team loop: takes the traces of a successful attack on the Loan Approval Agent and dispatches a **Cursor Cloud Agent** that opens a PR fixing `agents/loan_approval_agent/`, returning a fix summary + PR URL (`npm run fix:serve` for the HTTP service, `npm run fix:smoke` for a dry run). Weave-traced.
- Attack KB subsystem under `attack-kb/`, with Redis-backed retrieval, Blaxel recommendationBuilder, and W&B Weave tracing
- Replay-first CopilotKit + Weave demo dashboard in `apps/demo-dashboard/` (`npm run dashboard:dev`)
- Hackathon logistics in `docs/weavehacks-setup.md`
- Submission checklist in `docs/submission-checklist.md`
- Agent setup docs in `docs/agent-setup.md`
- Repo instructions for Codex, Claude Code, Gemini, Cursor, and Copilot

## Quick start
```bash
cp .env.example .env
npm install
npm run typecheck
npm run weave:smoke -- "an agent with visible evals and traces"
npm run attack-kb:config
npm run attack-kb:redis-health
npm run attack-kb:probe
npm run attack-kb:evals
npm run attack-kb:sandbox-smoke
npm run attack-kb:smoke -- "suggest one credit-loan probing recommendation"
npm run dev -- "help me turn inbox triage into a weekend demo"
```

Dashboard demo:
```bash
npm run dashboard:dev
```

## Env vars
Fill in:
- `WANDB_API_KEY` — used by W&B Weave tracing/logging
- `WANDB_ENTITY`
- `WANDB_PROJECT`
- `OPENAI_API_KEY` — used for direct OpenAI model calls
- `BL_API_KEY` / `BL_WORKSPACE` — Blaxel sandbox, needed for `npm run main:agent`, `npm run sub:agents`, and live Attack KB sandbox agents
- `CURSOR_API_KEY` — Cursor Background Agents API key, needed for the Fix Agent (`npm run fix:serve`); optional `FIX_AGENT_REPO`, `FIX_AGENT_REF`, `FIX_AGENT_MODEL`, `FIX_AGENT_PORT`, `FIX_AGENT_WAIT_MS`
- optional: `OPENAI_MODEL`, `BLAXEL_SANDBOX_IMAGE`, `BLAXEL_SANDBOX_MEMORY`, `BLAXEL_SANDBOX_REGION`
- optional Attack KB Redis report/storage vars: `ATTACK_KB_STORAGE_ADAPTER`, `ATTACK_KB_REDIS_IRIS_URL`, `ATTACK_KB_REDIS_IRIS_INDEX`, `ATTACK_KB_REDIS_IRIS_NAMESPACE`, `ATTACK_KB_REDIS_KEY_PREFIX`, `ATTACK_KB_REDIS_HEALTH_CONNECT`

Attack KB per-agent model overrides:
- `ATTACK_KB_LLM_PROVIDER=openai`
- `ATTACK_KB_SOURCE_GATHERING_MODEL`
- `ATTACK_KB_CREDIBILITY_TRIAGE_MODEL`
- `ATTACK_KB_CURATOR_MODEL`
- `ATTACK_KB_RECOMMENDER_MODEL`

Attack KB optional LLM cache:
- `ATTACK_KB_LLM_CACHE=disabled|local|redis`
- `ATTACK_KB_LLM_CACHE_TTL_SECONDS`
- `ATTACK_KB_REDIS_CACHE_URL`

No secrets should be committed. Put real values in local `.env` only.

## Handy commands
- `npm run typecheck`
- `npm run weave:smoke -- "idea"`
- `npm run attack-kb:config` — verifies `OPENAI_API_KEY` + `WANDB_API_KEY` presence and prints selected subagent models
- `npm run attack-kb:redis-health` — prints sanitized Redis config/readiness and intended key/index/stream names without connecting by default
- `npm run attack-kb:probe` — returns deterministic probing recommendations for an empty credit-loan profile, no API keys required
- `npm run attack-kb:evals` — runs deterministic quality evals; traces to W&B Weave when `WANDB_API_KEY` is set
- `npm run attack-kb:sandbox-smoke` — prints the Blaxel/SubAgentService sandbox config for an Attack KB role without launching Blaxel
- `npm run attack-kb:smoke -- "prompt"` — makes one traced OpenAI call through the Attack KB recommendation-builder runtime unless the optional exact-key LLM cache hits
- `npm run dev -- "problem statement"`
- `npm run main:agent -- "task for the sandbox agent"` (one-shot CLI)
- `npm run main:serve` (main agent as an HTTP service on `MAIN_AGENT_PORT`/`PORT`, default `8080`)
- `npm run sub:agents` (starts the sub-agents service on `PORT`, default `3000`)
- `npm run dashboard:dev` (starts the CopilotKit Weave replay dashboard)
- `npm run dashboard:test`
- `npm run dashboard:typecheck`

## Deploying the main agent
The main agent is a one-shot CLI by default; `agents/main_agent/server.ts` wraps
it as a long-running HTTP service so it can be deployed:

```bash
npm run main:serve                       # local: POST /run, GET /health
curl -s localhost:8080/health
curl -s localhost:8080/run -X POST -H 'content-type: application/json' \
  -d '{"prompt":"attack the loan agent as dave"}'
```

Each `POST /run` runs the orchestrator once against a fresh Blaxel sandbox with
its own sub-agent registry, so concurrent requests are isolated. Only the harness
runs in-process — the shell/file compute runs on Blaxel micro-VMs — so the
service just needs the same env vars and outbound network. A `Dockerfile` is
included; build and run with the credentials passed at runtime:

```bash
docker build -t main-agent .
docker run --rm -p 8080:8080 \
  -e OPENAI_API_KEY -e BL_API_KEY -e BL_WORKSPACE \
  -e WANDB_API_KEY -e WANDB_ENTITY -e WANDB_PROJECT \
  main-agent
```

See `agents/main_agent/README.md` for the full endpoint and env reference.

## Agent setup
See `docs/agent-setup.md`.

Repo includes:
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.mcp.json`
- `.codex/config.toml`
- `.cursor/mcp.json`
- `.gemini/settings.json`
- repo-local weave skills for Claude Code and Codex

## Suggested repo shape
```text
agents/   agent logic, prompts, tool wiring
  main_agent/  OpenAI Sandbox Agent (Weave-traced); orchestrates sub-agents as tools
  sub_agents/  service: create_agent, send_message, load_skill, terminal (HTTP/SSE + in-process)
apps/     demo applications
  demo-dashboard/  replay-first CopilotKit dashboard for Weave traces and regressions
evals/    datasets and evaluation scripts
scripts/  setup/dev helpers
docs/     hackathon notes, submission copy, demo plan
src/      starter app code with Weave instrumentation
attack-kb/ Attack KB subsystem code, docs, seeds, evals, and prototypes
```

## Hackathon reminders
- Public GitHub repo required
- Must use W&B Weave
- Submission deadline: `1:00 PM Sunday`
- Commit early and often
