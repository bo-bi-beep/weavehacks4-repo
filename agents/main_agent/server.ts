import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import {
  getWeaveProjectName,
  initWeave,
  isWeaveEnabled,
  requireEnv,
} from "../../src/lib/weave.js";
import { DEFAULT_PROMPT, loadedSkills, runMainAgent } from "./index.js";

/**
 * HTTP front door for the Main Agent — a thin wrapper that makes the otherwise
 * one-shot CLI ({@link runMainAgent}) deployable as a long-running service.
 *
 * Endpoints:
 *
 *   POST /run     { "prompt"?: string }  -> { output, skills, tracing }
 *   GET  /health                          -> { ok, skills, tracing }
 *
 * Each `POST /run` runs the adversarial orchestrator once against a fresh Blaxel
 * sandbox. `runMainAgent` builds its own `SubAgentService` per call, so
 * concurrent requests never share a sub-agent registry or tear down each other's
 * sandboxes. The actual compute (shell, files) runs on Blaxel micro-VMs, so this
 * process only needs outbound network — no inbound port beyond the one it
 * listens on. A client hang-up aborts the in-flight run so its sandbox is torn
 * down instead of leaking.
 */
export function createMainAgentServer() {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: errMessage(err) });
      else if (!res.writableEnded) res.end();
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      skills: loadedSkills,
      tracing: isWeaveEnabled(),
    });
  }

  if (url.pathname === "/run") {
    if (method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const body = await readJson(req);
    const raw = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const prompt = raw || DEFAULT_PROMPT;

    // Cancel the run if the client hangs up so the Blaxel sandbox doesn't leak.
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    let output: string;
    try {
      output = await runMainAgent(prompt, { signal: controller.signal });
    } catch (err) {
      // An aborted run surfaces as an error; the client is already gone, so
      // there's nothing to respond to — just close the socket.
      if (controller.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }
      throw err;
    }

    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    return sendJson(res, 200, {
      output,
      skills: loadedSkills,
      tracing: isWeaveEnabled(),
    });
  }

  return sendJson(res, 404, { error: "Not found" });
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
  // Blaxel sandbox auth — each run executes on its own Blaxel micro-VM,
  // consumed by @blaxel/core when a session is created.
  requireEnv("BL_API_KEY");
  requireEnv("BL_WORKSPACE");
  const tracing = await initWeave();

  // Prefer MAIN_AGENT_PORT, fall back to the PaaS-injected PORT, then 8080.
  // (The sub-agents service defaults to 3000, so the two don't collide locally.)
  const port = Number(process.env.MAIN_AGENT_PORT ?? process.env.PORT) || 8080;
  const server = createMainAgentServer();

  server.listen(port, () => {
    console.log(`main-agent service listening on http://localhost:${port}`);
    console.log(
      tracing
        ? `Tracing to W&B Weave project: ${getWeaveProjectName()}`
        : "Weave tracing disabled (set WANDB_API_KEY to enable).",
    );
    console.log(
      loadedSkills.length
        ? `Loaded skills: ${loadedSkills.join(", ")}`
        : "No skills loaded (set MAIN_AGENT_SKILLS to load some).",
    );
    console.log();
    console.log("Endpoints:");
    console.log('  POST /run      { "prompt"?: string }  run the agent once');
    console.log("  GET  /health                          liveness probe");
  });

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run only when invoked directly (`tsx agents/main_agent/server.ts`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
