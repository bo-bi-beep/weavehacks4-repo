# sub_agents

A small **service** that manages many OpenAI **Sandbox Agents** behind an HTTP +
SSE API. It builds on the same primitives as [`agents/main_agent`](../main_agent/)
— a [`SandboxAgent`](https://developers.openai.com/api/docs/guides/agents/sandboxes)
run against a `UnixLocalSandboxClient` — and is wired into this repo's W&B Weave
tracing.

Where `main_agent` is a single one-shot agent, `sub_agents` is a registry of
addressable, multi-turn agents you can create, message, extend with skills, and
drop a terminal into — all at runtime.

Each agent owns **one persistent sandbox session**, so its filesystem survives
across messages and is shared by the agent and its terminal.

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

- `OPENAI_API_KEY` — required (model + sandbox execution)
- `OPENAI_MODEL` — optional, defaults to `gpt-5.4-mini`
- `WANDB_API_KEY` / `WANDB_ENTITY` / `WANDB_PROJECT` — Weave tracing
- `PORT` — HTTP port, defaults to `3000`

The local sandbox client requires a Unix-like host (macOS or Linux).

## Reuse in-process

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
- `index.ts` — barrel re-export for in-process reuse.
