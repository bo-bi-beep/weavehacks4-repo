import {
  createAttackKbRedisClient,
  readAttackKbRedisConnectionConfig,
} from "../redis/client.js";
import { createAttackKbStorageAdapter, getAttackKbStorageConfig } from "../storage/index.js";
import { ATTACK_KB_SOURCE_CATEGORIES } from "../types.js";
import type {
  AttackKbCanonicalObject,
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  EvidenceSourceType,
  SourceArtifact,
  SourceEvidence,
  SourceProvenance,
} from "../types.js";
import type { CuratedSourceArtifactInput, PersistedSourceArtifact } from "./types.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 86);
}

function dateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/gu, "");
}

function ensureCategory(value: AttackKbSourceCategory): AttackKbSourceCategory {
  if (!ATTACK_KB_SOURCE_CATEGORIES.includes(value)) {
    throw new Error(`Unsupported curated source category: ${value}`);
  }

  return value;
}

function ensureEvidence(evidence: SourceEvidence[]): SourceEvidence[] {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error("Curated source artifacts require at least one evidence item.");
  }

  return evidence.map((item) => ({
    summary: item.summary,
    excerpt: item.excerpt,
    locator: item.locator,
    confidence: item.confidence,
    observedAt: item.observedAt || new Date().toISOString(),
  }));
}

function normalizeProvenance(
  input: CuratedSourceArtifactInput,
  retrievedBy: SourceProvenance["retrievedBy"] = "source_retrieval_agent",
): SourceProvenance {
  return {
    category: ensureCategory(input.category),
    originLabel: input.provenance.originLabel || input.title,
    publisher: input.provenance.publisher,
    url: input.provenance.url || input.url,
    retrievedAt: input.provenance.retrievedAt || new Date().toISOString(),
    retrievedBy: input.provenance.retrievedBy || retrievedBy,
    sourceVersion: input.provenance.sourceVersion,
    standardsRefs: input.provenance.standardsRefs?.length ? input.provenance.standardsRefs : [input.category],
    license: input.provenance.license,
  };
}

export function buildCuratedSourceArtifactObject(
  input: CuratedSourceArtifactInput,
  now = new Date(),
): AttackKbCanonicalObject<"source_artifact"> {
  const category = ensureCategory(input.category);
  const evidence = ensureEvidence(input.evidence);
  const provenance = normalizeProvenance(input);
  const id = input.id || `source-live-${slugify(input.title || input.url)}-${dateStamp(now)}`;
  const payload: SourceArtifact = {
    id,
    title: input.title,
    sourceType: input.sourceType,
    category,
    url: input.url,
    description: input.description,
    provenance,
    evidence,
  };

  return {
    id,
    objectType: "source_artifact",
    title: input.title,
    description: input.description,
    version: 1,
    updatedAt: now.toISOString(),
    sourceRefs: [],
    tags: [
      "ingested-source",
      "live-retrieved",
      "triage-approved",
      "curator-written",
      category,
      ...provenance.standardsRefs,
      ...input.tags,
    ].filter((tag, index, tags): tag is string => Boolean(tag) && tags.indexOf(tag) === index),
    payload,
  };
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textOf).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    return Object.values(value).map(textOf).filter(Boolean).join("\n");
  }
  return String(value);
}

function sourceProjection(object: AttackKbCanonicalObject<"source_artifact">): Record<string, unknown> {
  const payload = object.payload;
  const projection = {
    id: object.id,
    object_type: object.objectType,
    title: object.title,
    description: object.description,
    source_type: payload.sourceType,
    category: payload.category,
    url: payload.url ?? "",
    provenance: textOf(payload.provenance),
    evidence: textOf(payload.evidence),
    tags: object.tags,
    source_refs: object.sourceRefs,
    updated_at: object.updatedAt,
    payload,
  };

  return {
    ...projection,
    search_text: textOf(projection),
  };
}

async function writeContextProjection(
  object: AttackKbCanonicalObject<"source_artifact">,
): Promise<string | undefined> {
  const redisConfig = readAttackKbRedisConnectionConfig();
  if (!redisConfig.url) {
    return undefined;
  }

  const client = createAttackKbRedisClient(redisConfig);
  await client.connect();
  const key = `source_artifact:${object.id}`;

  try {
    await client.sendCommand(["JSON.SET", key, "$", JSON.stringify(sourceProjection(object))]);
    return key;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function persistCuratedSourceArtifacts(
  inputs: CuratedSourceArtifactInput[],
): Promise<PersistedSourceArtifact[]> {
  const config = getAttackKbStorageConfig();
  const storage = createAttackKbStorageAdapter({
    ...config,
    seedOnEmpty: false,
  });

  try {
    const persisted: PersistedSourceArtifact[] = [];
    for (const input of inputs) {
      const object = buildCuratedSourceArtifactObject(input);
      await storage.put(object);
      const contextProjectionKey = await writeContextProjection(object);
      persisted.push({
        id: object.id,
        objectType: object.objectType,
        title: object.title,
        redisKey: `${config.redisIris.namespace}:${config.redisIris.indexName}:object:${object.id}`,
        contextProjectionKey,
      });
    }

    return persisted;
  } finally {
    await storage.close?.();
  }
}

export type { AttackKbStorageObjectType, EvidenceSourceType, SourceEvidence, SourceProvenance };
