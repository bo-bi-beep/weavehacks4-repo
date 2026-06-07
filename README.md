# weavehacks4-repo

Starter repo for WeaveHacks 4, with W&B Weave wired in early.

## What is already set up
- TypeScript/Node starter with Weave helpers in `src/lib/weave.ts`
- OpenAI + Weave example path in `src/index.ts`
- Weave smoke test in `src/smoke.ts`
- Adversarial OpenAI Sandbox Agent on a Blaxel sandbox in `agents/main_agent/` (`npm run main:agent`) that attacks the Loan Approval Agent for vulnerabilities, loads the `loan-approval-agent` skill by default (`MAIN_AGENT_SKILLS` to override), and can orchestrate sub-agents as tools
- Sub-agents service in `agents/sub_agents/` — used both as an HTTP/SSE API (`npm run sub:agents`) and in-process as the main agent's sub-agent tools
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
npm run dev -- "help me turn inbox triage into a weekend demo"
```

Dashboard demo:
```bash
npm run dashboard:dev
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
- `npm run main:agent -- "task for the sandbox agent"`
- `npm run sub:agents` (starts the sub-agents service on `PORT`, default `3000`)
- `npm run dashboard:dev` (starts the CopilotKit Weave replay dashboard)
- `npm run dashboard:test`
- `npm run dashboard:typecheck`

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
```

## Hackathon reminders
- Public GitHub repo required
- Must use W&B Weave
- Submission deadline: `1:00 PM Sunday`
- Commit early and often
