# weavehacks4-repo

Starter repo for WeaveHacks 4, with W&B Weave wired in early.

## What is already set up
- TypeScript/Node starter with Weave helpers in `src/lib/weave.ts`
- OpenAI + Weave example path in `src/index.ts`
- Weave smoke test in `src/smoke.ts`
- Python `SubAgentManager` for parallel FinTech loan-agent red teaming in `agents/sub_agent_manager.py`
- Adversarial OpenAI Sandbox Agent on a Blaxel sandbox in `agents/main_agent/` (`npm run main:agent` for the one-shot CLI, `npm run main:serve` for the HTTP service) that attacks the Loan Approval Agent for vulnerabilities, loads the `loan-approval-agent` skill by default (`MAIN_AGENT_SKILLS` to override), and can orchestrate sub-agents as tools
- Sub-agents service in `agents/sub_agents/` — used both as an HTTP/SSE API (`npm run sub:agents`) and in-process as the main agent's sub-agent tools
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
npm run dev -- "help me turn inbox triage into a weekend demo"
```

Python red-team demo:
```bash
python3.10 -m pip install -r requirements.txt
python3.10 -m agents.sub_agent_manager
```

Export selected Weave trace fields:
```bash
python3.10 -m agents.main_agent.main_agent_module.trace_exporter \
  --project "$WANDB_ENTITY/$WANDB_PROJECT" \
  --output data/weave_traces/latest_trace_calls.jsonl \
  --limit 100
```

Custom field selection:
```bash
python3.10 -m agents.main_agent.main_agent_module.trace_exporter \
  --fields "id,op_name,trace_id,inputs.attack_direction,output.is_breached,summary.weave.status"
```

## Env vars
Fill in:
- `WANDB_API_KEY`
- `WANDB_ENTITY`
- `WANDB_PROJECT`
- `OPENAI_API_KEY`
- `BL_API_KEY` / `BL_WORKSPACE` (Blaxel sandbox — needed for `npm run main:agent` and `npm run sub:agents`)
- optional: `OPENAI_MODEL`, `BLAXEL_SANDBOX_IMAGE`, `BLAXEL_SANDBOX_MEMORY`, `BLAXEL_SANDBOX_REGION`

## Handy commands
- `npm run typecheck`
- `npm run weave:smoke -- "idea"`
- `npm run dev -- "problem statement"`
- `npm run main:agent -- "task for the sandbox agent"` (one-shot CLI)
- `npm run main:serve` (main agent as an HTTP service on `MAIN_AGENT_PORT`/`PORT`, default `8080`)
- `npm run sub:agents` (starts the sub-agents service on `PORT`, default `3000`)

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
evals/    datasets and evaluation scripts
scripts/  setup/dev helpers
docs/     hackathon notes, submission copy, demo plan
src/      starter app code with Weave instrumentation
```

## Hackathon reminders
- Public GitHub repo required
- Must use W&B Weave
- Submission deadline: `1:00 PM Sunday`
- Commit early and often
