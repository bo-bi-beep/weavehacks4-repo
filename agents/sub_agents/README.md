# sub_agents

A small **service** that manages many OpenAI **Sandbox Agents** behind an HTTP +
SSE API. It builds on the same primitives as [`agents/main_agent`](../main_agent/)
— a [`SandboxAgent`](https://developers.openai.com/api/docs/guides/agents/sandboxes)
run against a **Blaxel** sandbox via `BlaxelSandboxClient` — and is wired into
this repo's W&B Weave tracing.

Where `main_agent` is a single one-shot agent, `sub_agents` is a registry of
addressable, multi-turn agents you can create, message, extend with skills, and
drop a terminal into — all at runtime.

Each agent owns **one persistent Blaxel sandbox session** — its own uniquely
named micro-VM — so its filesystem survives across messages and is shared by the
agent and its terminal. The shared Blaxel config lives in
[`src/lib/blaxel.ts`](../../src/lib/blaxel.ts) (`createBlaxelSandboxClient`), the
same helper `main_agent` uses.

## Endpoints

| Verb + path | Purpose | Response |
| --- | --- | --- |
| `POST /agents` | **create_agent** — register a sub-agent | `201` JSON summary (incl. `id`) |
| `POST /agents/:id/messages` | **send_message** — stream a reply | `200` **SSE** event stream |
| `POST /agents/:id/skills` | **load_skill** — mount a repo skill | `200` JSON result |
| `POST /agents/:id/terminal` | **terminal** — run a shell command | `200` JSON result |
| `GET /agents` / `GET /agents/:id` | list / fetch agents | `200` JSON |
| `DELETE /agents/:id` | remove an agent (tears down its session) | `200` JSON |
| `GET /health` | liveness probe | `200` JSON |

### `POST /agents` — create_agent
Body (all optional): `{ "name", "instructions", "task", "model" }`. A `task` is
seeded into the sandbox workspace as `task.md`. Returns
`{ id, name, model, skills, turns }`.

### `POST /agents/:id/messages` — send_message (SSE)
Body: `{ "message": "..." }`. Responds with `text/event-stream`. Each frame is an
`event: <type>` / `data: <json>` pair:

- `delta` — `{ text }`, incremental assistant text
- `item` — `{ name, itemType }`, a tool call / output / message item
- `agent_updated` — `{ agent }`, active agent changed
- `done` — `{ finalOutput, turns, historyLength }`, turn complete
- `error` — `{ message }`

Conversation history persists across messages (via the SDK's `result.history`)
and the sandbox filesystem persists in the agent's live session, so each call
continues the same conversation against the same workspace. Closing the
connection aborts the underlying run.

### `POST /agents/:id/skills` — load_skill
Body: `{ "skill": "weave-integration" }`. Resolves the named repo skill
(`.claude/skills/<skill>/SKILL.md`, then `.agents/skills/<skill>/SKILL.md`),
mounts its `SKILL.md` into the agent's sandbox at `skills/<skill>/SKILL.md`, and
nudges the agent (via its instructions) to consult it. If the agent's session is
already live the file appears immediately; otherwise it is seeded when the
session starts. Returns `{ ok, skill, sandboxPath, sourcePath, bytes }`.

### `POST /agents/:id/terminal` — terminal
Body: `{ "command": "...", "workdir"?, "login"?, "shell"? }`. Runs the command
directly (bypassing the model) in the **same persistent workspace** the agent
reads and writes, then returns
`{ command, stdout, stderr, output, exitCode, wallTimeSeconds }`. A non-zero
`exitCode` is reported, not thrown.

> The Blaxel remote session returns combined output rather than separate
> streams, so `stdout` and `output` carry the merged stdout+stderr and `stderr`
> is empty; `exitCode` and `wallTimeSeconds` are recovered best-effort.

## Run it

From the **repo root** (the directory with `package.json`):

```bash
npm run sub:agents
# sub-agents service listening on http://localhost:3000
```

Honors `PORT` (default `3000`).

## Try it with curl

```bash
# 1) create_agent
ID=$(curl -s localhost:3000/agents \
  -H 'content-type: application/json' \
  -d '{"name":"Math Helper","task":"Calculate 1 + 25 and report the result."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

# 2) load_skill (optional)
curl -s localhost:3000/agents/$ID/skills \
  -H 'content-type: application/json' \
  -d '{"skill":"weave-integration"}'

# 3) terminal -> run a shell command in the agent's sandbox
curl -s localhost:3000/agents/$ID/terminal \
  -H 'content-type: application/json' \
  -d '{"command":"ls -la && cat task.md"}'

# 4) send_message -> streamed over SSE (same workspace as the terminal)
curl -N localhost:3000/agents/$ID/messages \
  -H 'content-type: application/json' \
  -d '{"message":"Read task.md and complete the task it describes."}'
```

## Env vars

- `OPENAI_API_KEY` — required (model calls)
- `OPENAI_MODEL` — optional, defaults to `gpt-5.4-mini`
- `BL_API_KEY` — required (Blaxel sandbox auth)
- `BL_WORKSPACE` — required (Blaxel workspace)
- `BLAXEL_SANDBOX_IMAGE` — optional, defaults to `blaxel/base-image`
- `BLAXEL_SANDBOX_MEMORY` — optional MB, defaults to `4096`
- `BLAXEL_SANDBOX_REGION` — optional, defaults to `us-pdx-1` (US West); also `eu-lon-1`, `us-was-1`
- `BLAXEL_SANDBOX_NAME` — optional; used as a **prefix** for each agent's sandbox
  name (`<prefix>-<agent-id>`), since each agent gets its own micro-VM
- `WANDB_API_KEY` / `WANDB_ENTITY` / `WANDB_PROJECT` — Weave tracing
- `PORT` — HTTP port, defaults to `3000`
- `REDIS_URL` — optional; enables the durable registry (see **Persistence** below)
- `SUBAGENT_TTL_SECONDS` — optional; expire registry entries to match the Blaxel
  sandbox TTL
- `REDIS_KEY_PREFIX` — optional; Redis key prefix (default `subagent`)
- `SUBAGENT_REATTACH` — optional; keep sandbox micro-VMs alive across restarts and
  re-attach by name instead of recreating from the manifest (see **Persistence**)

The sandbox runs remotely on Blaxel, so no special host is required. Get
`BL_API_KEY` / `BL_WORKSPACE` from your Blaxel workspace
(<https://docs.blaxel.ai/Sandboxes/Overview>).

## Persistence & restarts

By default the registry is **in-memory** — agents (and their chat history) are
lost when the process exits. Set `REDIS_URL` to make it **durable**: each agent's
serializable state is stored at `subagent:<id>` (with a `subagent:index` set
listing all ids), so a restarted — or horizontally scaled — service recovers
every agent's identity, loaded skills, and conversation memory.

What is and isn't persisted:

- **Persisted (in the store):** id, name, model, instructions, the workspace
  manifest (`task.md` + loaded skills), loaded skill names, and the SDK
  conversation `history`.
- **Not persisted:** the live Blaxel sandbox session — it's a per-process socket.
  It's cached in memory and re-opened on demand.

**Registry durability** (above) and **sandbox filesystem continuity** are
separate concerns:

- The Redis registry always survives a restart — agents keep their identity,
  skills, and chat history.
- The live sandbox's *filesystem* is recovered only on the recreate path by
  default. On a cache miss (e.g. the first request after a restart) the service
  **recreates** the sandbox from the stored manifest — the agent keeps its memory
  and seed files (`task.md` + skills); only un-persisted scratch files are lost.

Set `SUBAGENT_REATTACH=1` to instead keep micro-VMs alive on shutdown (detach,
not destroy) and **re-attach** to the agent's existing, uniquely named VM on the
next request, preserving files written mid-run. An explicit `DELETE /agents/:id`
always tears the VM down regardless.

> Re-attach is feature-detected against the sandbox client and safely falls back
> to recreate-from-manifest. Enable `SUBAGENT_REATTACH` only after confirming the
> exact re-attach method for your installed `@openai/agents-extensions`; with a
> kept-alive VM that the client can't re-attach to, a recreate could collide.

A single durable instance works out of the box. Running **multiple** instances
additionally needs a per-agent lock (so two requests don't drive the same
sandbox at once) — the `subagent:lock:<id>` key is reserved for that next step.

## Reuse in-process

[`agents/main_agent`](../main_agent/) consumes this service this way — it wraps a
`SubAgentService` as function tools (`spawn_sub_agent`, `ask_sub_agent`, …) so the
main agent can spawn and delegate to a dynamic number of sub-agents within one
traced run, no HTTP server required.

The service runs without the HTTP layer, too:

```ts
import { SubAgentService } from "./agents/sub_agents/index.js";

const service = new SubAgentService();
const { id } = await service.createAgent({ task: "Calculate 1 + 25." });
await service.loadSkill(id, "weave-integration");

// terminal: run a command directly in the agent's sandbox
const { stdout, exitCode } = await service.runCommand(id, "ls && cat task.md");

for await (const event of service.sendMessage(id, "Do the task.")) {
  if (event.type === "delta") process.stdout.write(event.text);
}

await service.deleteAgent(id); // tears down the sandbox session
```

## Weave tracing

`createAgent`, `loadSkill`, `runCommand` (`subAgentTerminal`), and each completed
turn (`subAgentTurn`) are wrapped as Weave ops, so agent creation, skill loads,
terminal commands, and the prompt/response of every message show up in the demo
trace.

## Files

- `service.ts` — `SubAgentService`: `createAgent`, `sendMessage`, `loadSkill`,
  `runCommand`.
- `server.ts` — `node:http` server exposing the endpoints (SSE for messages).
- `store.ts` — `SubAgentStore` interface, `InMemorySubAgentStore`, and the
  `createSubAgentStore()` env-driven factory.
- `redis_store.ts` — `RedisSubAgentStore`, the durable registry used when
  `REDIS_URL` is set.
- `index.ts` — barrel re-export for in-process reuse.
