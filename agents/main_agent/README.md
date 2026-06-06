# main_agent

A **Sandbox Agent** built on the OpenAI Agents SDK
([`@openai/agents`](https://www.npmjs.com/package/@openai/agents)), wired into
this repo's W&B Weave tracing. It doubles as an **orchestrator**: it can spawn
and delegate to a dynamic number of sandboxed sub-agents.

Reference: <https://developers.openai.com/api/docs/guides/agents/sandboxes>

## What it is

A Sandbox Agent runs in an isolated environment with its own filesystem and
shell. This one is:

- a `Manifest` that seeds the workspace with a `task.md`
- a `SandboxAgent` (`mainAgent`) with the `shell()` capability **and** a set of
  function tools for spawning/driving sub-agents (see below)
- a Weave-traced `runMainAgent(prompt)` entry point that executes the agent
  against a **Blaxel** sandbox via `BlaxelSandboxClient`
  (`@openai/agents-extensions/sandbox/blaxel`, backed by `@blaxel/core`)

The `harness` (model calls, agent logic, sub-agent control) stays in this
process; the `compute` (files, shell commands) runs inside a Blaxel micro-VM.
The runner creates the sandbox session from `defaultManifest` and tears it down
when the run finishes.

## Orchestrating sub-agents

The main agent is connected to [`agents/sub_agents`](../sub_agents/) **as
tools**, not over HTTP. `index.ts` holds one in-process `SubAgentService`
(the same registry the HTTP service wraps) and exposes it to the model via
`createSubAgentTools(service)` from `sub_agent_tools.ts`:

| Tool | Drives | What it does |
| --- | --- | --- |
| `spawn_sub_agent` | `createAgent` (+ `loadSkill`) | Create a sandboxed sub-agent (its own Blaxel micro-VM) from a `task`; optionally preload repo skills. Returns its `id`. |
| `ask_sub_agent` | `sendMessage` | Send a message to a sub-agent and return its full reply (the SSE stream, drained to `finalOutput`). |
| `load_skill` | `loadSkill` | Mount a repo skill's `SKILL.md` into a sub-agent. |
| `run_in_sub_agent` | `runCommand` | Run a shell command directly in a sub-agent's sandbox (bypasses its model). |
| `list_sub_agents` | `listAgents` | List spawned sub-agents (id, name, model, skills, turns). |
| `stop_sub_agent` | `deleteAgent` | Remove a sub-agent and tear down its sandbox. |

Because these are plain `FunctionTool`s, they execute in the harness process,
while the agent's `shell()` runs in the sandbox — the SDK merges both into the
agent's tool list (`agent.tools` + capability tools). So the model can break a
task into independent parts and spawn **one sub-agent per part** at runtime,
delegate, then synthesize. Every spawn/ask/skill-load is a Weave op, so the full
fan-out is one nested trace. `runMainAgent` calls `service.closeAll()` in a
`finally`, so sub-agent micro-VMs never leak past the run.

The default `task.md` is a small fan-out demo (compute three independent items),
so a no-prompt run exercises the orchestration path end to end.

## Files

- `index.ts` — manifest, agent definition (with sub-agent tools), and the
  runnable CLI entry point.
- `sub_agent_tools.ts` — `createSubAgentTools(service)`: wraps a
  `SubAgentService` as the function tools above.

## Run it

Run from the **repo root** (the directory with `package.json`) — not from
inside `agents/main_agent/`:

```bash
npm run main:agent -- "list the files in the workspace and summarize the task"
```

With no prompt it defaults to reading `task.md` — the fan-out demo — so the agent
spawns a sub-agent per item and reports the combined result. This makes real
model calls and spins up one Blaxel micro-VM per sub-agent, so it needs live
`OPENAI_API_KEY`, `BL_API_KEY`, and `BL_WORKSPACE`.

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
