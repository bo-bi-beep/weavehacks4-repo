import "dotenv/config";

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingestAttackKbDataItem, ingestAttackKbSource } from "../ingestion/index.js";
import { buildSampleMaestroDataItem, sampleOwaspAgenticSource } from "../ingestion/sample.js";
import { createLocalAttackKbStorageAdapter } from "../storage/local.js";
import { buildSeedAttackKbObjects } from "../storage/seeds.js";
import { createCurationUiServer } from "./server.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };

  if (!response.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  return body;
}

const dir = await mkdtemp(join(tmpdir(), "attack-kb-curation-smoke-"));
const storage = createLocalAttackKbStorageAdapter({
  name: "attack-kb-curation-smoke-json",
  seedObjects: buildSeedAttackKbObjects(),
  jsonPath: join(dir, "kb.json"),
});

const source = await ingestAttackKbSource(sampleOwaspAgenticSource, { storage, trace: false });
await ingestAttackKbDataItem(buildSampleMaestroDataItem(source.object.id), { storage, trace: false });

const server = createCurationUiServer({ storage });
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
assert(address && typeof address === "object", "Expected server to listen on a TCP port.");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const health = await request<{ ok: boolean }>(baseUrl, "/api/health");
  assert(health.ok, "Health endpoint failed.");

  const list = await request<{ candidates: { candidate: { payload: { id: string } }; proposedObjects: unknown[] }[] }>(
    baseUrl,
    "/api/candidates",
  );
  assert(list.candidates.length >= 2, "Expected pending curation candidates.");

  const candidateId = list.candidates[0].candidate.payload.id;
  assert(list.candidates[0].proposedObjects.length > 0, "Expected proposed canonical objects.");

  const autoReview = await request<{ decision: { payload: { action: string; score?: number } } }>(
    baseUrl,
    `/api/candidates/${encodeURIComponent(candidateId)}/auto-review`,
    { method: "POST", body: "{}" },
  );
  assert(autoReview.decision.payload.action, "Expected auto-review proposed action.");

  const decision = await request<{
    decision: { payload: { action: string } };
    persistedObjects: unknown[];
    candidate: { payload: { status: string } };
  }>(baseUrl, `/api/candidates/${encodeURIComponent(candidateId)}/decision`, {
    method: "POST",
    body: JSON.stringify({
      action: "accept",
      reviewerId: "smoke-test",
      rationale: "Smoke test accepted one pending candidate after inspecting evidence and auto-review.",
    }),
  });
  assert(decision.decision.payload.action === "accept", "Expected accept decision to persist.");
  assert(decision.persistedObjects.length > 0, "Expected accepted objects to be persisted.");
  assert(decision.candidate.payload.status === "accepted", "Expected candidate status to update.");

  const detail = await request<{ candidate: { reviewHistory: unknown[]; candidate: { payload: { status: string } } } }>(
    baseUrl,
    `/api/candidates/${encodeURIComponent(candidateId)}`,
  );
  assert(detail.candidate.reviewHistory.length >= 2, "Expected auto-review and human decision history.");
  assert(detail.candidate.candidate.payload.status === "accepted", "Expected accepted status in detail context.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        message: "Attack KB curation UI smoke passed without a browser.",
        baseUrl,
        candidateId,
        autoReview: autoReview.decision.payload,
        persistedObjects: decision.persistedObjects.length,
        reviewHistory: detail.candidate.reviewHistory.length,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}
