import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";

import { initWeave, weave } from "../../src/lib/weave.js";
import { getAttackKbRecommendations, type AttackKbRecommendationOptions } from "./recommendations.js";
import { getOrCreateCachedAttackKbRecommendationResponse } from "./server-recommendation-cache.js";
import type { AgentUnderTestProfile } from "./types.js";

export type AttackKbRecommendationRequestBody = {
  profile?: AgentUnderTestProfile;
  options?: Pick<AttackKbRecommendationOptions, "requestId" | "mainIrisContext" | "recommendationBuilder">;
};

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function asRequestBody(value: unknown): AttackKbRecommendationRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recommendation request body must be a JSON object.");
  }

  const body = value as AttackKbRecommendationRequestBody;
  return {
    profile: body.profile ?? {},
    options: body.options ?? {},
  };
}

const tracedRecommendationRequest = weave.op(
  async function attackKbRecommendationServerRequest(body: AttackKbRecommendationRequestBody) {
    return getAttackKbRecommendations(body.profile ?? {}, body.options ?? {});
  },
  { name: "attackKbRecommendationServerRequest" },
);

const tracedCachedRecommendationRequest = weave.op(
  async function attackKbCachedRecommendationServerRequest(body: AttackKbRecommendationRequestBody) {
    return getOrCreateCachedAttackKbRecommendationResponse(body, () => tracedRecommendationRequest(body));
  },
  { name: "attackKbCachedRecommendationServerRequest" },
);

export function createAttackKbServer() {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");

      if (method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true, service: "attack-kb" });
        return;
      }

      if (method === "POST" && url.pathname === "/api/recommendations") {
        await initWeave();
        const body = asRequestBody(await readJsonBody(req));
        json(res, 200, await tracedRecommendationRequest(body));
        return;
      }

      if (method === "POST" && url.pathname === "/api/recommendations/cached") {
        await initWeave();
        const body = asRequestBody(await readJsonBody(req));
        json(res, 200, await tracedCachedRecommendationRequest(body));
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function parseAttackKbServerPort(): number {
  const isRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID,
  );
  const value = isRailway
    ? process.env.PORT ?? process.env.ATTACK_KB_PORT ?? "3030"
    : process.env.ATTACK_KB_PORT ?? process.env.PORT ?? "3030";
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ${isRailway ? "PORT/ATTACK_KB_PORT" : "ATTACK_KB_PORT/PORT"} value: ${value}`);
  }

  return port;
}

export function startAttackKbServer() {
  const server = createAttackKbServer();
  const port = parseAttackKbServerPort();
  server.listen(port, () => {
    console.log(`Attack KB server listening on http://localhost:${port}`);
    console.log("POST /api/recommendations to retrieve Redis artifacts and run the Attack KB recommendationBuilder.");
    console.log("POST /api/recommendations/cached to reuse a cached full recommendation response on repeat requests.");
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startAttackKbServer();
}
