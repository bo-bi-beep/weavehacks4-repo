import "dotenv/config";

import { createServer, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { buildAttackKbMainAgentDemoFlow } from "./flow.js";
import { renderAttackKbDemoHtml } from "./ui.js";

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

export function createAttackKbDemoServer() {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");

      if (method === "GET" && url.pathname === "/") {
        html(res, renderAttackKbDemoHtml());
        return;
      }

      if (method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/demo") {
        json(res, 200, await buildAttackKbMainAgentDemoFlow());
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function parsePort(): number {
  const value = process.env.ATTACK_KB_DEMO_PORT ?? "3020";
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ATTACK_KB_DEMO_PORT value: ${value}`);
  }

  return port;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAttackKbDemoServer();
  const port = parsePort();
  server.listen(port, () => {
    console.log(`Attack KB main-agent demo listening on http://localhost:${port}`);
    console.log("Open the URL to see probing → observed profile → composed recommendations → delivery subagents.");
  });
}
