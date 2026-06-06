import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { getDefaultAttackKbStorageAdapter, type AttackKbStorageAdapter } from "../storage/index.js";
import { ingestAttackKbDataItem, ingestAttackKbSource } from "../ingestion/index.js";
import { buildSampleMaestroDataItem, sampleOwaspAgenticSource } from "../ingestion/sample.js";
import {
  autoReviewCurationCandidate,
  getCurationCandidateContext,
  listCurationCandidateContexts,
  recordCurationDecision,
  type RecordCurationDecisionInput,
} from "./service.js";
import { renderCurationUiHtml } from "./ui.js";

export type CurationUiServerOptions = {
  storage?: AttackKbStorageAdapter;
  seedDemo?: boolean;
};

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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function asDecisionInput(value: unknown): RecordCurationDecisionInput {
  if (!value || typeof value !== "object") {
    throw new Error("Decision body must be a JSON object.");
  }

  const input = value as Partial<RecordCurationDecisionInput>;
  if (!input.action || !["accept", "reject", "edit", "merge"].includes(input.action)) {
    throw new Error("Decision action must be accept, reject, edit, or merge.");
  }

  if (!input.rationale?.trim()) {
    throw new Error("Decision rationale is required.");
  }

  return {
    action: input.action,
    reviewerId: input.reviewerId,
    rationale: input.rationale,
    score: input.score,
    selectedProposedObjectIds: input.selectedProposedObjectIds,
    editedObjects: input.editedObjects,
    mergeTargetId: input.mergeTargetId,
  };
}

async function seedDemoCandidates(storage: AttackKbStorageAdapter): Promise<void> {
  const existing = await storage.list({ objectType: "curation_candidate", limit: 1 });
  if (existing.length > 0) {
    return;
  }

  const sourceResult = await ingestAttackKbSource(sampleOwaspAgenticSource, { storage, trace: false });
  await ingestAttackKbDataItem(buildSampleMaestroDataItem(sourceResult.object.id), { storage, trace: false });
}

export function createCurationUiServer(options: CurationUiServerOptions = {}) {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  let seeded = false;

  return createServer(async (req, res) => {
    try {
      if (options.seedDemo && !seeded) {
        await seedDemoCandidates(storage);
        seeded = true;
      }

      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (method === "GET" && path === "/") {
        html(res, renderCurationUiHtml());
        return;
      }

      if (method === "GET" && path === "/api/health") {
        json(res, 200, {
          ok: true,
          storage: { name: storage.name, backend: storage.backend },
        });
        return;
      }

      if (method === "GET" && path === "/api/candidates") {
        const status = url.searchParams.get("status") ?? "pending";
        const contexts = await listCurationCandidateContexts({
          storage,
          status: status === "all" ? "all" : status === "accepted" || status === "rejected" || status === "merged" || status === "queued" || status === "review_required" ? status : "pending",
        });
        json(res, 200, { candidates: contexts });
        return;
      }

      const candidateMatch = path.match(/^\/api\/candidates\/([^/]+)$/);
      if (method === "GET" && candidateMatch) {
        json(res, 200, { candidate: await getCurationCandidateContext(decodeURIComponent(candidateMatch[1]), { storage }) });
        return;
      }

      const autoReviewMatch = path.match(/^\/api\/candidates\/([^/]+)\/auto-review$/);
      if (method === "POST" && autoReviewMatch) {
        json(res, 200, await autoReviewCurationCandidate(decodeURIComponent(autoReviewMatch[1]), { storage }));
        return;
      }

      const decisionMatch = path.match(/^\/api\/candidates\/([^/]+)\/decision$/);
      if (method === "POST" && decisionMatch) {
        const body = await readJsonBody(req);
        json(res, 200, await recordCurationDecision(decodeURIComponent(decisionMatch[1]), asDecisionInput(body), { storage }));
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function parsePort(): number {
  const value = process.env.ATTACK_KB_CURATION_UI_PORT ?? process.env.PORT ?? "3010";
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid ATTACK_KB_CURATION_UI_PORT/PORT value: ${value}`);
  }

  return port;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createCurationUiServer({ seedDemo: process.argv.includes("--seed-demo") });
  const port = parsePort();
  server.listen(port, () => {
    console.log(`Attack KB curation UI listening on http://localhost:${port}`);
    console.log(`Storage: ${getDefaultAttackKbStorageAdapter().name} (${getDefaultAttackKbStorageAdapter().backend})`);
    console.log("Use --seed-demo to create sample pending candidates when storage is empty.");
  });
}
