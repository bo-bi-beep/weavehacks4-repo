# Repository instructions

## Purpose
This repo is a WeaveHacks 4 starter. Keep W&B Weave visible from day 1 so the final demo and submission clearly show sponsor usage.

## First files to read
- `docs/agent-setup.md`
- `docs/submission-checklist.md`
- `src/lib/weave.ts`

## Rules
- Preserve or improve W&B Weave instrumentation; do not remove it casually.
- Initialize Weave through `src/lib/weave.ts`.
- When adding LLM calls, prefer traced clients or `weave.op` wrappers.
- For Attack KB direct OpenAI calls, use `attack-kb/src/runtime.ts` so calls are traced through Weave and per-role models stay configurable.
- For live Attack KB sandbox agents, use `attack-kb/src/sandbox.ts`; it mirrors `agents/sub_agents` and the shared Blaxel sandbox client while preserving the no-direct-Agent-Under-Test boundary.
- Keep `.env.example` updated when env vars change.
- Keep README and submission docs aligned with actual architecture.
- Bias toward small, demoable vertical slices over broad unfinished systems.

## Handy commands
- `npm run typecheck`
- `npm run weave:smoke -- "your idea here"`
- `npm run attack-kb:config`
- `npm run attack-kb:smoke -- "suggest one probing route"`
- `npm run attack-kb:sandbox-smoke`
- `npm run dev -- "your problem statement here"`

## Agent-specific extras
- Claude Code repo skill: `.claude/skills/weave-integration/SKILL.md`
- Codex repo skill: `.agents/skills/weave-integration/SKILL.md`
- MCP setup notes: `docs/agent-setup.md`
