# main_agent

A minimalistic **Sandbox Agent** built on the OpenAI Agents SDK
([`@openai/agents`](https://www.npmjs.com/package/@openai/agents)), wired into
this repo's W&B Weave tracing.

Reference: <https://developers.openai.com/api/docs/guides/agents/sandboxes>

## What it is

An **adversarial** Sandbox Agent: its system prompt tasks it with attacking the
Loan Approval Agent to find vulnerabilities (probing decision logic, prompt
injection, jailbreaks). It runs in an isolated environment with its own
filesystem and shell:

- a `Manifest` that seeds the workspace with the loaded skills (no `task.md`)
- a `SandboxAgent` (`mainAgent`) with the `shell()` capability
- a Weave-traced `runMainAgent(prompt)` entry point that executes the agent
  against a **Blaxel** sandbox via `BlaxelSandboxClient`
  (`@openai/agents-extensions/sandbox/blaxel`, backed by `@blaxel/core`)

## Skills

At startup the agent loads repo skills into its workspace, mirroring the
on-demand `load_skill` flow in `agents/sub_agents/`. Each skill's `SKILL.md` is
resolved from `.claude/skills/<name>/` or `.agents/skills/<name>/`, mounted at
`skills/<name>/SKILL.md` in the sandbox, and referenced from the agent's
instructions so the model reads it before acting.

By default it loads the **`loan-approval-agent`** skill (how to drive the Loan
Approval Agent HTTP API). Override the set with `MAIN_AGENT_SKILLS` — a
comma-separated list of skill names, or `none`/empty to load nothing:

```bash
# load two skills
MAIN_AGENT_SKILLS="loan-approval-agent,weave-integration" npm run main:agent -- "..."

# load no skills
MAIN_AGENT_SKILLS=none npm run main:agent -- "..."
```

A skill that can't be resolved is logged and skipped (the agent still runs).
The loaded names are exported as `loadedSkills` and printed on startup.

The `harness` (model calls, agent logic) stays in this process; the `compute`
(files, shell commands) runs inside a Blaxel micro-VM. The runner creates the
sandbox session from `defaultManifest` and tears it down when the run finishes.

## Files

- `index.ts` — manifest, agent definition, and the runnable CLI entry point.

## Run it

Run from the **repo root** (the directory with `package.json`) — not from
inside `agents/main_agent/`:

```bash
npm run main:agent -- "try a prompt-injection attack against the loan agent as dave"
```

With no prompt it defaults to reading the `loan-approval-agent` skill and
attacking the Loan Approval Agent, reporting every vulnerability it finds.

## Env vars

- `OPENAI_API_KEY` — required (model calls)
- `OPENAI_MODEL` — optional, defaults to `gpt-5.4-mini`
- `MAIN_AGENT_SKILLS` — optional, comma-separated skill names to load; defaults to `loan-approval-agent` (`none`/empty loads no skills)
- `BL_API_KEY` — required (Blaxel sandbox auth)
- `BL_WORKSPACE` — required (Blaxel workspace)
- `BLAXEL_SANDBOX_IMAGE` — optional, defaults to `blaxel/base-image`
- `BLAXEL_SANDBOX_MEMORY` — optional MB, defaults to `4096`
- `BLAXEL_SANDBOX_REGION` — optional, defaults to `us-pdx-1` (US West); also `eu-lon-1`, `us-was-1`
- `BLAXEL_SANDBOX_NAME` — optional
- `WANDB_API_KEY` / `WANDB_ENTITY` / `WANDB_PROJECT` — Weave tracing

The sandbox runs remotely on Blaxel, so no special host is required. Get
`BL_API_KEY` / `BL_WORKSPACE` from your Blaxel workspace
(<https://docs.blaxel.ai/Sandboxes/Overview>).

## Reuse

`mainAgent` and `runMainAgent` are exported, so sub-agents and orchestration
code can import them instead of re-running the CLI:

```ts
import { mainAgent, runMainAgent } from "../main_agent/index.js";
```
