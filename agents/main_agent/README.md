# main_agent

A minimalistic **Sandbox Agent** built on the OpenAI Agents SDK
([`@openai/agents`](https://www.npmjs.com/package/@openai/agents)), wired into
this repo's W&B Weave tracing.

Reference: <https://developers.openai.com/api/docs/guides/agents/sandboxes>

## What it is

A Sandbox Agent runs in an isolated, Unix-like environment with its own
filesystem and shell. This is the smallest version of that:

- a `Manifest` that seeds the workspace with a `task.md`
- a `SandboxAgent` (`mainAgent`) with the `shell()` capability
- a Weave-traced `runMainAgent(prompt)` entry point that executes the agent
  against a local `UnixLocalSandboxClient`

The `harness` (model calls, agent logic) stays in this process; the `compute`
(files, shell commands) runs inside the sandbox.

## Files

- `index.ts` — manifest, agent definition, and the runnable CLI entry point.

## Run it

Run from the **repo root** (`los-angeles-v2/`, the directory with
`package.json`) — not from inside `agents/main_agent/`:

```bash
npm run main:agent -- "list the files in the workspace and summarize the task"
```

With no prompt it defaults to listing the workspace and summarizing `task.md`.

## Env vars

- `OPENAI_API_KEY` — required (model + sandbox execution)
- `OPENAI_MODEL` — optional, defaults to `gpt-4.1-mini`
- `WANDB_API_KEY` / `WANDB_ENTITY` / `WANDB_PROJECT` — Weave tracing

The local sandbox client requires a Unix-like host (macOS or Linux).

## Reuse

`mainAgent` and `runMainAgent` are exported, so sub-agents and orchestration
code can import them instead of re-running the CLI:

```ts
import { mainAgent, runMainAgent } from "../main_agent/index.js";
```
