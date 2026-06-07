# main_agent

A **Sandbox Agent** built on the OpenAI Agents SDK
([`@openai/agents`](https://www.npmjs.com/package/@openai/agents)), wired into
this repo's W&B Weave tracing. It doubles as an **orchestrator**: it can spawn
and delegate to a dynamic number of sandboxed sub-agents.

Reference: <https://developers.openai.com/api/docs/guides/agents/sandboxes>

## What it is

An **adversarial** Sandbox Agent: its system prompt tasks it with attacking the
Loan Approval Agent to find vulnerabilities (probing decision logic, prompt
injection, jailbreaks). It runs in an isolated environment with its own
filesystem and shell:

- a `Manifest` that seeds the workspace with the loaded skills (no `task.md`)
- a `SandboxAgent` (`mainAgent`) with the `shell()` capability **and** a set of
  function tools for spawning/driving sub-agents (see below)
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

## Orchestrating sub-agents

The main agent is connected to [`agents/sub_agents`](../sub_agents/) **as
tools**, not over HTTP. `index.ts` holds one in-process `SubAgentService`
(the same registry the HTTP service wraps) and exposes it to the model via
`createSubAgentTools(service)` from `sub_agent_tools.ts`:

| Tool | Drives | What it does |
| --- | --- | --- |
| `spawn_sub_agent` | `createAgent` (+ `loadSkill`) | Create a sandboxed sub-agent (its own Blaxel micro-VM) from a `task`; optionally preload repo skills. Returns its `id`. |
| `ask_sub_agent` | `sendMessage` | Run the trace-feedback workflow, send the evolved message to a sub-agent, and return its full reply (the SSE stream, drained to `finalOutput`). |
| `load_skill` | `loadSkill` | Mount a repo skill's `SKILL.md` into a sub-agent. |
| `run_in_sub_agent` | `runCommand` | Run a shell command directly in a sub-agent's sandbox (bypasses its model). |
| `list_sub_agents` | `listAgents` | List spawned sub-agents (id, name, model, skills, turns). |
| `stop_sub_agent` | `deleteAgent` | Remove a sub-agent and tear down its sandbox. |

Because these are plain `FunctionTool`s, they execute in the harness process,
while the agent's `shell()` runs in the sandbox — the SDK merges both into the
agent's tool list (`agent.tools` + capability tools). So the adversarial agent
can break an attack plan into independent probes, spawn **one sub-agent per
probe** at runtime, delegate, then synthesize. Every tool call is streamed to the
console and recorded as a nested Weave op; `runMainAgent` calls
`service.closeAll()` in a `finally`, so sub-agent micro-VMs never leak past the
run.

## Self-evolving trace feedback

`trace_insights.ts` loads recent Weave Calls with the TypeScript SDK
(`client.getCalls(...)`), normalizes each Call, and extracts records such as:

```json
{"status": "recorded", "decision": "approved", "expected_decision": "denied"}
```

`attack_guidance_workflow.ts` turns those records into an evolved sub-agent
instruction on every `ask_sub_agent` call:

1. load the latest sub-agent/AUT trace history
2. extract breaches, blocked tactics, and decision mismatches
3. synthesize an evolved attack direction plus the orchestrator's probe intent

The main agent only supplies probe intent in `ask_sub_agent.message`; the
harness runs the workflow automatically before delivery. Each new delegated
attack therefore uses the latest known history instead of a static prompt.

## Files

- `index.ts` — manifest, agent definition (with sub-agent tools), and the
  runnable CLI entry point.
- `sub_agent_tools.ts` — `createSubAgentTools(service)`: wraps a
  `SubAgentService` as the function tools above.
- `trace_insights.ts` — loads and analyzes Weave trace history.
- `attack_guidance_workflow.ts` — automatic pre-delegation workflow that
  synthesizes evolved attack guidance from trace insights.

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
- `MAIN_AGENT_TRACE_LIMIT` — optional number of recent Weave Calls to inspect before delegating to a sub-agent; defaults to `50`
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
