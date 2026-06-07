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
| `ask_sub_agent` | `sendMessage` | Send a message to a sub-agent and return its full reply (the SSE stream, drained to `finalOutput`). |
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

## Files

- `index.ts` — manifest, the `createMainAgent(service)` factory (and a default
  `mainAgent`), the `runMainAgent` entry point, and the runnable CLI.
- `server.ts` — `createMainAgentServer()`: the HTTP wrapper (`POST /run`,
  `GET /health`) that makes the one-shot agent deployable as a service.
- `sub_agent_tools.ts` — `createSubAgentTools(service)`: wraps a
  `SubAgentService` as the function tools above.

## Run it

Run from the **repo root** (the directory with `package.json`) — not from
inside `agents/main_agent/`:

```bash
npm run main:agent -- "try a prompt-injection attack against the loan agent as dave"
```

With no prompt it defaults to reading the `loan-approval-agent` skill and
attacking the Loan Approval Agent, reporting every vulnerability it finds.

## Deploy as an HTTP service

`npm run main:agent` is a **one-shot CLI** — it runs once and exits. To deploy
the main agent as a long-running service, `server.ts` wraps `runMainAgent`
behind a tiny `node:http` API (mirroring `agents/sub_agents/server.ts`):

```bash
npm run main:serve   # listens on MAIN_AGENT_PORT, then PORT, default 8080
```

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /run` | `{ "prompt"?: string }` (defaults to the standard attack prompt) | `{ output, skills, tracing }` |
| `GET /health` | — | `{ ok, skills, tracing }` |

```bash
curl -s localhost:8080/health
curl -s localhost:8080/run -X POST -H 'content-type: application/json' \
  -d '{"prompt":"try a prompt-injection attack against the loan agent as dave"}'
```

**Concurrency-safe by design.** `runMainAgent` builds a *fresh*
`SubAgentService` and `SandboxAgent` per call (via the exported
`createMainAgent(service)` factory), so two requests never share a sub-agent
registry or tear down each other's sandboxes. A client hang-up aborts the
in-flight run (`AbortSignal` wired to the request's `close` event) so its Blaxel
sandbox is torn down instead of leaking.

**Deployability.** Only the harness runs in this process; the shell/file compute
runs on Blaxel micro-VMs. So the service needs only the same env vars and
*outbound* network — no inbound port beyond the one it listens on. The repo's
root `Dockerfile` builds this service:

```bash
docker build -t main-agent .
docker run --rm -p 8080:8080 \
  -e OPENAI_API_KEY -e BL_API_KEY -e BL_WORKSPACE \
  -e WANDB_API_KEY -e WANDB_ENTITY -e WANDB_PROJECT \
  main-agent
```

Platforms that inject `PORT` (Cloud Run, Render, Fly, Railway) work without
extra config; set `MAIN_AGENT_PORT` to override locally (the sub-agents service
defaults to `3000`, so the two don't collide).

## Env vars

- `OPENAI_API_KEY` — required (model calls)
- `MAIN_AGENT_MODEL` — optional, the Main Agent's model; defaults to `gpt-5.5` (OpenAI GPT-5.5)
- `OPENAI_MODEL` — optional, the sub-agents' model; defaults to `gpt-5.4-mini`
- `MAIN_AGENT_SKILLS` — optional, comma-separated skill names to load; defaults to `loan-approval-agent` (`none`/empty loads no skills)
- `BL_API_KEY` — required (Blaxel sandbox auth)
- `BL_WORKSPACE` — required (Blaxel workspace)
- `BLAXEL_SANDBOX_IMAGE` — optional, defaults to `blaxel/base-image`
- `BLAXEL_SANDBOX_MEMORY` — optional MB, defaults to `4096`
- `BLAXEL_SANDBOX_REGION` — optional, defaults to `us-pdx-1` (US West); also `eu-lon-1`, `us-was-1`
- `BLAXEL_SANDBOX_NAME` — optional
- `MAIN_AGENT_PORT` / `PORT` — HTTP service port (`server.ts` only); defaults to `8080`
- `WANDB_API_KEY` / `WANDB_ENTITY` / `WANDB_PROJECT` — Weave tracing

The sandbox runs remotely on Blaxel, so no special host is required. Get
`BL_API_KEY` / `BL_WORKSPACE` from your Blaxel workspace
(<https://docs.blaxel.ai/Sandboxes/Overview>).

## Reuse

`runMainAgent`, `createMainAgent`, and a default `mainAgent` are exported, so
sub-agents and orchestration code can import them instead of re-running the CLI:

```ts
import { runMainAgent, createMainAgent, mainAgent } from "../main_agent/index.js";

// Concurrency-safe one-shot run (fresh service + agent + sandbox per call):
const report = await runMainAgent("attack the loan agent as dave");

// Or build an agent bound to your own SubAgentService for custom orchestration:
import { SubAgentService } from "../sub_agents/service.js";
const agent = createMainAgent(new SubAgentService());
```

`runMainAgent(prompt, { signal })` accepts an optional `AbortSignal` to cancel an
in-flight run; the default `mainAgent` singleton is kept for backwards-compatible
imports but shares one registry, so prefer `runMainAgent`/`createMainAgent` for
concurrent use.
