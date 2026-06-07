import {
  createAttackKbRedisClient,
  readAttackKbRedisConnectionConfig,
} from "../redis/client.js";
import { createAttackKbStorageAdapter, getAttackKbStorageConfig } from "../storage/index.js";
import type {
  AttackKbCanonicalObject,
  AttackKbDomain,
  AttackKbStorageObjectType,
  AttackKbStoragePayloadByType,
  AttackPhase,
  DeliveryMode,
  EvidenceSource,
  SourceEvidence,
  SourceProvenance,
  SuccessSignal,
  SystemAttackPattern,
  AttackPattern,
  Vulnerability,
} from "../types.js";
import {
  CURATED_DERIVED_OBJECT_TYPES,
  type CuratedDerivedArtifactInput,
  type CuratedDerivedObjectType,
  type PersistedDerivedArtifact,
} from "./types.js";

const SAFE_BOUNDARY =
  "Defensive synthetic Attack KB evaluation only. Do not use for real-world fraud, evasion, credential theft, unauthorized access, or bypass instructions.";

const CONTEXT_KEY_PREFIX_BY_TYPE: Partial<Record<AttackKbStorageObjectType, string>> = {
  domain_decision_factor: "decision_factor",
  recon_probe: "recon_probe",
  domain_scenario: "domain_scenario",
  business_attack_route: "business_route",
  system_attack_pattern: "system_pattern",
  vulnerability: "vulnerability",
  attack_pattern: "attack_pattern",
  evidence_source: "evidence_source",
  source_artifact: "source_artifact",
  ingested_data_item: "ingested_data_item",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 86);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizePhase(value: unknown): AttackPhase {
  const phase = asString(value, "probing");
  return phase === "attack" || phase === "validation" ? phase : "probing";
}

function normalizeSeverity(value: unknown): Vulnerability["severity"] {
  const severity = asString(value, "medium");
  return severity === "low" || severity === "medium" || severity === "high" || severity === "critical"
    ? severity
    : "medium";
}

function normalizeVulnerabilityCategory(value: unknown): Vulnerability["category"] {
  const category = asString(value, "business_logic");
  if (
    category === "prompt_injection" ||
    category === "tool_misuse" ||
    category === "rag_memory" ||
    category === "policy_bypass" ||
    category === "business_logic"
  ) {
    return category;
  }

  return "business_logic";
}

function normalizeDeliveryChannel(value: unknown): DeliveryMode["channel"] {
  const channel = asString(value, "chat");
  if (channel === "chat" || channel === "tool_output" || channel === "rag_document" || channel === "memory" || channel === "api") {
    return channel;
  }

  return "chat";
}

function normalizeEvidence(value: unknown): SourceEvidence[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const evidence = value.map((entry) => {
    const item = asRecord(entry);
    return {
      summary: asString(item.summary, "Source evidence summary."),
      excerpt: asString(item.excerpt) || undefined,
      locator: asString(item.locator) || undefined,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      observedAt: asString(item.observedAt, new Date().toISOString()),
    } satisfies SourceEvidence;
  });

  return evidence.length > 0 ? evidence : undefined;
}

function normalizeProvenance(value: unknown): SourceProvenance | undefined {
  const item = asRecord(value);
  const originLabel = asString(item.originLabel);
  const url = asString(item.url);
  if (!originLabel && !url) {
    return undefined;
  }

  return {
    category: asString(item.category, "vendor_documentation") as SourceProvenance["category"],
    originLabel: originLabel || url,
    publisher: asString(item.publisher) || undefined,
    url: url || undefined,
    retrievedAt: asString(item.retrievedAt, new Date().toISOString()),
    retrievedBy: "source_retrieval_agent",
    sourceVersion: asString(item.sourceVersion) || undefined,
    standardsRefs: asStringArray(item.standardsRefs),
    license: asString(item.license) || undefined,
  };
}

function assertDerivedObjectType(value: string): asserts value is CuratedDerivedObjectType {
  if (!CURATED_DERIVED_OBJECT_TYPES.includes(value as CuratedDerivedObjectType)) {
    throw new Error(`Unsupported curated derived object type: ${value}`);
  }
}

function payloadFor(input: CuratedDerivedArtifactInput): AttackKbStoragePayloadByType[CuratedDerivedObjectType] {
  const payload = asRecord(input.payload);
  const id = input.id;
  const title = input.title;
  const description = input.description;

  if (input.objectType === "vulnerability") {
    return {
      id,
      domain: "credit_loan",
      title,
      description,
      category: normalizeVulnerabilityCategory(payload.category),
      severity: normalizeSeverity(payload.severity),
      safetyBoundary: asString(payload.safetyBoundary, SAFE_BOUNDARY),
    } satisfies Vulnerability;
  }

  if (input.objectType === "attack_pattern") {
    return {
      id,
      domain: "credit_loan",
      phase: normalizePhase(payload.phase),
      title,
      description,
      vulnerabilityRefs: asStringArray(payload.vulnerabilityRefs),
      safetyBoundary: asString(payload.safetyBoundary, SAFE_BOUNDARY),
    } satisfies AttackPattern;
  }

  if (input.objectType === "system_attack_pattern") {
    return {
      id,
      title,
      description,
      defensiveObjective: asString(payload.defensiveObjective, description),
      safetyBoundary: asString(payload.safetyBoundary, SAFE_BOUNDARY),
    } satisfies SystemAttackPattern;
  }

  if (input.objectType === "evidence_source") {
    return {
      id,
      title,
      sourceType: (asString(payload.sourceType, "documentation") as EvidenceSource["sourceType"]),
      url: asString(payload.url || input.sourceRefs[0]) || undefined,
      description,
      retrievedAt: asString(payload.retrievedAt) || undefined,
      provenance: normalizeProvenance(payload.provenance),
      evidence: normalizeEvidence(payload.evidence),
    } satisfies EvidenceSource;
  }

  if (input.objectType === "delivery_mode") {
    return {
      id,
      title,
      description,
      channel: normalizeDeliveryChannel(payload.channel),
      safetyBoundary: asString(payload.safetyBoundary, SAFE_BOUNDARY),
    } satisfies DeliveryMode;
  }

  return {
    id,
    title,
    description,
    observable: asString(payload.observable, description),
    safetyBoundary: asString(payload.safetyBoundary, SAFE_BOUNDARY),
  } satisfies SuccessSignal;
}

export function buildCuratedDerivedObject(
  input: CuratedDerivedArtifactInput,
  now = new Date(),
): AttackKbCanonicalObject<CuratedDerivedObjectType> {
  assertDerivedObjectType(input.objectType);

  return {
    id: input.id || `${input.objectType}-${slugify(input.title)}`,
    objectType: input.objectType,
    domain: input.objectType === "evidence_source" || input.objectType === "delivery_mode" || input.objectType === "success_signal"
      ? undefined
      : (input.domain ?? "credit_loan") as AttackKbDomain,
    title: input.title,
    description: input.description,
    version: 1,
    updatedAt: now.toISOString(),
    sourceRefs: uniq(input.sourceRefs),
    tags: uniq(["source-derived", "triage-approved", "curator-written", input.objectType, ...input.tags]),
    payload: payloadFor(input),
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

function contextProjection(object: AttackKbCanonicalObject): Record<string, unknown> {
  const payload = asRecord(object.payload);
  const projection = {
    id: object.id,
    object_type: object.objectType,
    domain: object.domain ?? "",
    title: object.title,
    description: object.description ?? "",
    tags: object.tags,
    source_refs: object.sourceRefs,
    updated_at: object.updatedAt,
    safety_boundary: asString(payload.safetyBoundary),
    category: asString(payload.category),
    severity: asString(payload.severity),
    phase: asString(payload.phase),
    vulnerability_refs: asStringArray(payload.vulnerabilityRefs),
    defensive_objective: asString(payload.defensiveObjective),
    source_type: asString(payload.sourceType),
    url: asString(payload.url),
    provenance: textOf(payload.provenance),
    evidence: textOf(payload.evidence),
    channel: asString(payload.channel),
    observable: asString(payload.observable),
    payload,
  };

  return {
    ...projection,
    search_text: textOf(projection),
  };
}

async function writeContextProjection(
  object: AttackKbCanonicalObject,
): Promise<string | undefined> {
  const prefix = CONTEXT_KEY_PREFIX_BY_TYPE[object.objectType];
  const redisConfig = readAttackKbRedisConnectionConfig();
  if (!prefix || !redisConfig.url) {
    return undefined;
  }

  const client = createAttackKbRedisClient(redisConfig);
  await client.connect();
  const key = `${prefix}:${object.id}`;

  try {
    await client.sendCommand(["JSON.SET", key, "$", JSON.stringify(contextProjection(object))]);
    return key;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function persistCuratedDerivedArtifacts(
  inputs: CuratedDerivedArtifactInput[],
): Promise<PersistedDerivedArtifact[]> {
  const config = getAttackKbStorageConfig();
  const storage = createAttackKbStorageAdapter({
    ...config,
    seedOnEmpty: false,
  });

  try {
    const persisted: PersistedDerivedArtifact[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      const object = buildCuratedDerivedObject(input);
      const key = `${object.objectType}:${object.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
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
