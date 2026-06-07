import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { getWeaveProjectName, initWeave, isWeaveEnabled } from "./lib/weave.js";
import {
  DEFAULT_REPOSITORY,
  runFixAgent,
  type FixAgentTraces,
  type RunFixAgentOptions,
} from "./index.js";

/**
 * HTTP front door for the Fix Agent.
 *
 * Endpoints:
 *   POST /fix      { traces, repository?, ref?, model?, dryRun? }
 *                  Calls Claude to diagnose the attack, generates a fix, creates
 *                  a branch, commits the changed files, and opens a GitHub PR.
 *                  The PR is open for human review — it is NOT auto-merged.
 *                  -> { prUrl, branchName, prNumber, summary, pending, tracing }
 *
 *   GET  /health   -> { ok, configured, repository, tracing }
 */
export function createFixAgentServer() {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: errMessage(err) });
      else if (!res.writableEnded) res.end();
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "fix-agent",
      configured:
        Boolean(process.env.ANTHROPIC_API_KEY?.trim()) &&
        Boolean(process.env.GITHUB_TOKEN?.trim()),
      repository: DEFAULT_REPOSITORY,
      tracing: isWeaveEnabled(),
    });
  }

  if (url.pathname === "/fix") {
    if (method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const body = (await readJson(req)) as Record<string, unknown>;
    const traces = body.traces as FixAgentTraces | undefined;

    if (!hasTraces(traces)) {
      return json(res, 400, {
        error:
          "Request body must include `traces`: the transcript/record of the successful attack " +
          "(a string, an object, or an array of attack-trace objects).",
      });
    }

    const options: RunFixAgentOptions = {
      repository: asString(body.repository),
      ref: asString(body.ref),
      model: asString(body.model),
      dryRun: body.dryRun === true,
    };

    const result = await runFixAgent(traces, options);
    return json(res, 200, result);
  }

  return json(res, 404, { error: "Not found" });
}

function hasTraces(traces: unknown): traces is FixAgentTraces {
  if (typeof traces === "string") return traces.trim().length > 0;
  if (Array.isArray(traces)) return traces.length > 0;
  return typeof traces === "object" && traces !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

function parsePort(): number {
  const value = process.env.FIX_AGENT_PORT ?? process.env.PORT ?? "3040";
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid FIX_AGENT_PORT/PORT value: ${value}`);
  }
  return port;
}

async function main(): Promise<void> {
  const tracing = await initWeave();
  const server = createFixAgentServer();
  const port = parsePort();

  server.listen(port, () => {
    console.log(`fix-agent service listening on http://localhost:${port}`);
    console.log(
      tracing
        ? `Tracing to W&B Weave project: ${getWeaveProjectName()}`
        : "Weave tracing disabled (set WANDB_API_KEY to enable).",
    );
    const anthropicOk = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    const githubOk = Boolean(process.env.GITHUB_TOKEN?.trim());
    if (!anthropicOk) console.warn("[fix-agent] ANTHROPIC_API_KEY not set — POST /fix will fail.");
    if (!githubOk) console.warn("[fix-agent] GITHUB_TOKEN not set — POST /fix will fail.");
    console.log();
    console.log("Endpoints:");
    console.log('  POST /fix    { "traces": ... }   diagnose attack, generate fix, open GitHub PR');
    console.log("  GET  /health                     liveness probe");
  });

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
