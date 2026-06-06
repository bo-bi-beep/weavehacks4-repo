import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  getWeaveProjectName,
  initWeave,
  requireEnv,
} from "../../src/lib/weave.js";
import { AgentStreamEvent, SubAgentService } from "./service.js";

/**
 * HTTP + SSE front door for {@link SubAgentService}. Endpoints:
 *
 *   POST   /agents                 create_agent  -> { id, name, model, ... }
 *   POST   /agents/:id/messages    send_message  -> SSE stream of events
 *   POST   /agents/:id/skills      load_skill    -> { ok, skill, sandboxPath, ... }
 *   POST   /agents/:id/terminal    run a command -> { stdout, stderr, exitCode, ... }
 *   GET    /agents                 list agents
 *   GET    /agents/:id             get one agent
 *   DELETE /agents/:id             remove an agent
 *   GET    /health                 liveness probe
 */
export function createSubAgentsServer(service = new SubAgentService()) {
  return createServer((req, res) => {
    handle(service, req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: errMessage(err) });
      else res.end();
    });
  });
}

async function handle(
  service: SubAgentService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, agents: service.listAgents().length });
  }

  // /agents
  if (segments[0] === "agents" && segments.length === 1) {
    if (method === "GET") return sendJson(res, 200, { agents: service.listAgents() });
    if (method === "POST") {
      const body = await readJson(req);
      const summary = await service.createAgent(body);
      return sendJson(res, 201, summary);
    }
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  // /agents/:id (+ optional sub-resource)
  if (segments[0] === "agents" && segments.length >= 2) {
    const id = segments[1];
    const sub = segments[2];

    if (!sub) {
      if (method === "GET") {
        const summary = service.getAgent(id);
        return summary
          ? sendJson(res, 200, summary)
          : sendJson(res, 404, { error: `Unknown agent: ${id}` });
      }
      if (method === "DELETE") {
        const deleted = await service.deleteAgent(id);
        return sendJson(res, deleted ? 200 : 404, { ok: deleted });
      }
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    if (sub === "messages" && method === "POST") {
      const body = await readJson(req);
      const message = typeof body?.message === "string" ? body.message : "";
      if (!message.trim()) {
        return sendJson(res, 400, { error: "Missing 'message' in body" });
      }
      return streamMessage(service, id, message, req, res);
    }

    if (sub === "skills" && method === "POST") {
      const body = await readJson(req);
      const skill = typeof body?.skill === "string" ? body.skill : "";
      if (!skill.trim()) {
        return sendJson(res, 400, { error: "Missing 'skill' in body" });
      }
      const result = await service.loadSkill(id, skill);
      return sendJson(res, 200, result);
    }

    if (sub === "terminal" && method === "POST") {
      const body = await readJson(req);
      const command = typeof body?.command === "string" ? body.command : "";
      if (!command.trim()) {
        return sendJson(res, 400, { error: "Missing 'command' in body" });
      }
      const result = await service.runCommand(id, command, {
        workdir: typeof body?.workdir === "string" ? body.workdir : undefined,
        login: typeof body?.login === "boolean" ? body.login : undefined,
        shell: typeof body?.shell === "string" ? body.shell : undefined,
      });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: "Not found" });
  }

  return sendJson(res, 404, { error: "Not found" });
}

/** Runs send_message and forwards each event as an SSE frame. */
async function streamMessage(
  service: SubAgentService,
  id: string,
  message: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // Cancel the underlying run if the client hangs up.
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    for await (const event of service.sendMessage(id, message, {
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) break;
      sendSse(res, event);
    }
  } catch (err) {
    sendSse(res, { type: "error", message: errMessage(err) });
  } finally {
    res.end();
  }
}

function sendSse(res: ServerResponse, event: AgentStreamEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body is not valid JSON");
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  requireEnv("OPENAI_API_KEY");
  const tracing = await initWeave();

  const port = Number(process.env.PORT) || 3000;
  const service = new SubAgentService();
  const server = createSubAgentsServer(service);

  server.listen(port, () => {
    console.log(`sub-agents service listening on http://localhost:${port}`);
    console.log(
      tracing
        ? `Tracing to W&B Weave project: ${getWeaveProjectName()}`
        : "Weave tracing disabled (set WANDB_API_KEY to enable).",
    );
    console.log();
    console.log("Endpoints:");
    console.log("  POST   /agents                 create_agent");
    console.log("  POST   /agents/:id/messages    send_message (SSE)");
    console.log("  POST   /agents/:id/skills      load_skill");
    console.log("  POST   /agents/:id/terminal    run a shell command");
    console.log("  GET    /agents | /agents/:id | /health");
  });

  // Tear down live sandbox sessions on shutdown.
  const shutdown = () => {
    server.close();
    void service.closeAll().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run only when invoked directly (`tsx agents/sub_agents/server.ts`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
