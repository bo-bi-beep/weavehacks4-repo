# weavehacks4-repo

Starter repo for WeaveHacks 4, with W&B Weave wired in early.

## What is already set up
- TypeScript/Node starter with Weave helpers in `src/lib/weave.ts`
- OpenAI + Weave example path in `src/index.ts`
- Weave smoke test in `src/smoke.ts`
- Python `SubAgentManager` for parallel FinTech loan-agent red teaming in `agents/sub_agent_manager.py`
- Adversarial OpenAI Sandbox Agent on a Blaxel sandbox in `agents/main_agent/` (`npm run main:agent`) that attacks the Loan Approval Agent for vulnerabilities, loading the `loan-approval-agent` skill by default (`MAIN_AGENT_SKILLS` to override)
- Sub-agents HTTP/SSE service in `agents/sub_agents/` (`npm run sub:agents`)
- Attack KB subsystem under `attack-kb/`, with OpenAI-backed subagents and W&B Weave tracing
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
npm run attack-kb:probe
npm run attack-kb:smoke -- "suggest one credit-loan probing recommendation"
npm run dev -- "help me turn inbox triage into a weekend demo"
```

Python red-team demo:
```bash
python3.10 -m pip install -r requirements.txt
python3.10 -m agents.sub_agent_manager
```

## Env vars
Fill in:
- `WANDB_API_KEY` — used by W&B Weave tracing/logging
- `WANDB_ENTITY`
- `WANDB_PROJECT`
- `OPENAI_API_KEY` — used for direct OpenAI model calls
- `BL_API_KEY` / `BL_WORKSPACE` — Blaxel sandbox, needed for `npm run main:agent` and `npm run sub:agents`
- optional: `OPENAI_MODEL`, `BLAXEL_SANDBOX_IMAGE`, `BLAXEL_SANDBOX_MEMORY`, `BLAXEL_SANDBOX_REGION`

Attack KB per-agent model overrides:
- `ATTACK_KB_LLM_PROVIDER=openai`
- `ATTACK_KB_SOURCE_DISCOVERY_MODEL`
- `ATTACK_KB_SOURCE_RETRIEVAL_MODEL`
- `ATTACK_KB_CREDIBILITY_TRIAGE_MODEL`
- `ATTACK_KB_CURATOR_MODEL`
- `ATTACK_KB_RECOMMENDER_MODEL`

No secrets should be committed. Put real values in local `.env` only.

## Handy commands
- `npm run typecheck`
- `npm run weave:smoke -- "idea"`
- `npm run attack-kb:config` — verifies `OPENAI_API_KEY` + `WANDB_API_KEY` presence and prints selected subagent models
- `npm run attack-kb:probe` — returns deterministic probing recommendations for an empty credit-loan profile, no API keys required
- `npm run attack-kb:smoke -- "prompt"` — makes one traced OpenAI call through the Attack KB recommendation-builder runtime
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
  main_agent/  minimal OpenAI Sandbox Agent (Weave-traced)
  sub_agents/  HTTP/SSE service: create_agent, send_message, load_skill, terminal
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
