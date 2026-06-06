# weavehacks4-repo

Starter repo for WeaveHacks 4, with W&B Weave wired in early.

## What is already set up
- TypeScript/Node starter with Weave helpers in `src/lib/weave.ts`
- OpenAI + Weave example path in `src/index.ts`
- Weave smoke test in `src/smoke.ts`
- Python `SubAgentManager` for parallel FinTech loan-agent red teaming in `agents/sub_agent_manager.py`
- OpenAI Sandbox Agent on a Blaxel sandbox in `agents/main_agent/` that orchestrates sub-agents as tools (`npm run main:agent`)
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
- `npm run main:agent -- "task for the sandbox agent"`
- `npm run sub:agents` (starts the sub-agents service on `PORT`, default `3000`)

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
