# Agent setup

This repo already includes repo-scoped W&B Weave setup for several coding agents.

## Included in the repo
- `AGENTS.md` — shared repo instructions
- `CLAUDE.md` — Claude Code instructions
- `GEMINI.md` — Gemini CLI instructions
- `.claude/skills/weave-integration/SKILL.md` — Claude Code repo skill
- `.agents/skills/weave-integration/SKILL.md` — Codex repo skill
- `.mcp.json` — Claude Code W&B MCP config
- `.codex/config.toml` — Codex W&B MCP config
- `.cursor/mcp.json` — Cursor W&B MCP config
- `.gemini/settings.json` — Gemini CLI W&B MCP config
- `.github/copilot-instructions.md` — Copilot guidance

## Prerequisite env vars
Set these locally before launching your agent:

```bash
export WANDB_API_KEY=your-wandb-api-key
export WANDB_ENTITY=your-wandb-entity
export WANDB_PROJECT=weavehacks4-your-idea
export OPENAI_API_KEY=your-openai-api-key
export OPENAI_MODEL=gpt-4.1-mini
```

## Claude Code
What is already wired in:
- `CLAUDE.md`
- `.claude/skills/weave-integration/SKILL.md`
- `.mcp.json`

Typical flow:
1. Export `WANDB_API_KEY` before launching Claude Code.
2. Open this repo in Claude Code.
3. Approve the project MCP server if Claude prompts.
4. Ask Claude to use the repo's weave-integration skill when adding model flows or evals.

Optional official W&B skill install:
```bash
npx -y skills add wandb/skills --agent claude-code --skill '*' --yes
```

## Codex
What is already wired in:
- `AGENTS.md`
- `.agents/skills/weave-integration/SKILL.md`
- `.codex/config.toml`

Typical flow:
1. Export `WANDB_API_KEY` before launching Codex.
2. Open the repo from its root so `.codex/config.toml` and `.agents/skills` are visible.
3. Trust the project if Codex asks.
4. Mention `$weave-integration` explicitly if you want to force the repo skill.

Optional official W&B skill install:
```bash
npx -y skills add wandb/skills --agent codex --skill '*' --yes
```

## Cursor
What is already wired in:
- `AGENTS.md`
- `.cursor/mcp.json`

Typical flow:
1. Launch Cursor from a shell where `WANDB_API_KEY` is set, or set it in your environment first.
2. Open the repo and let Cursor discover `.cursor/mcp.json`.
3. Confirm the W&B MCP server if prompted.

Optional official W&B skill install:
```bash
npx -y skills add wandb/skills --agent cursor --skill '*' --yes
```

## Gemini CLI
What is already wired in:
- `GEMINI.md`
- `.gemini/settings.json`

Typical flow:
1. Export `WANDB_API_KEY` before launching Gemini CLI.
2. Start Gemini from the repo root.
3. Restart Gemini if you changed env vars or settings.

Optional official W&B skill install:
```bash
npx -y skills add wandb/skills --agent gemini-cli --skill '*' --yes
```

## GitHub Copilot
Included in the repo:
- `.github/copilot-instructions.md`
- `AGENTS.md`

Copilot guidance is doc-based here; MCP is not prewired for Copilot in this repo.

## Pi
I also set up a Pi/Realm project-local skill for this repo only.
It lives in your local Realm project state and is **not** committed to git or pushed to GitHub.

## Runtime sandbox agent
Separate from the coding-assistant wiring above, the repo ships a minimal
runtime agent in `agents/main_agent/` built on the OpenAI Agents SDK
(`@openai/agents`) Sandbox Agent pattern:
<https://developers.openai.com/api/docs/guides/agents/sandboxes>.

```bash
npm run main:agent -- "list the files in the workspace and summarize the task"
```

It needs `OPENAI_API_KEY` (and the usual `WANDB_*` vars for Weave tracing), and
the local sandbox client requires a Unix-like host (macOS or Linux). See
`agents/main_agent/README.md` for details.

## Notes
- No secrets are committed; all MCP files expect your local `WANDB_API_KEY`.
- If an agent does not pick up a new config file, restart it from the repo root.
- For broad W&B help beyond this repo's custom skill, the official package is `wandb/skills`.
