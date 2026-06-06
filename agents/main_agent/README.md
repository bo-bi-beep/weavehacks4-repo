# main_agent

A minimalistic **Sandbox Agent** built on the OpenAI Agents SDK
([`@openai/agents`](https://www.npmjs.com/package/@openai/agents)), wired into
this repo's W&B Weave tracing.

Reference: <https://developers.openai.com/api/docs/guides/agents/sandboxes>

## What it is

A Sandbox Agent runs in an isolated environment with its own filesystem and
shell. This is the smallest version of that:

- a `Manifest` that seeds the workspace with a `task.md`
- a `SandboxAgent` (`mainAgent`) with the `shell()` capability
- a Weave-traced `runMainAgent(prompt)` entry point that executes the agent
  against a **Blaxel** sandbox via `BlaxelSandboxClient`
  (`@openai/agents-extensions/sandbox/blaxel`, backed by `@blaxel/core`)

The `harness` (model calls, agent logic) stays in this process; the `compute`
(files, shell commands) runs inside a Blaxel micro-VM. The runner creates the
sandbox session from `defaultManifest` and tears it down when the run finishes.

## Files

- `index.ts` — manifest, agent definition, and the runnable CLI entry point.

## Run it

Run from the **repo root** (the directory with `package.json`) — not from
inside `agents/main_agent/`:

```bash
npm run main:agent -- "list the files in the workspace and summarize the task"
```

With no prompt it defaults to listing the workspace and summarizing `task.md`.

## Env vars

- `OPENAI_API_KEY` — required (model calls)
- `OPENAI_MODEL` — optional, defaults to `gpt-5.4-mini`
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
