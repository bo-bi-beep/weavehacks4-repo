import { randomUUID } from "node:crypto";

import { initWeave, weave } from "../../../src/lib/weave.js";
import { enqueueCurationCandidate, type CurationFlowEvent } from "../curation/queue.js";
import { getDefaultAttackKbStorageAdapter, type AttackKbStorageAdapter } from "../storage/index.js";
import { ATTACK_KB_SOURCE_CATEGORIES } from "../types.js";
import type {
  AttackKbCanonicalObject,
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  IngestedDataItem,
  SourceArtifact,
  SourceEvidence,
  SourceProvenance,
  CurationCandidate,
  EvidenceSourceType,
} from "../types.js";

export type SourceProvenanceInput = Partial<SourceProvenance> & {
  originLabel?: string;
  standardsRefs?: string[];
};

export type SourceEvidenceInput = Omit<SourceEvidence, "observedAt"> & {
  observedAt?: string;
};

export type AttackKbSourceIngestionInput = {
  id?: string;
  title: string;
  description: string;
  category: AttackKbSourceCategory;
  sourceType?: EvidenceSourceType;
  url?: string;
  provenance?: SourceProvenanceInput;
  evidence: SourceEvidenceInput[];
  suggestedObjectTypes?: AttackKbStorageObjectType[];
  tags?: string[];
};

export type AttackKbDataItemIngestionInput = {
  id?: string;
  title: string;
  dataType: IngestedDataItem["dataType"];
  category: AttackKbSourceCategory;
  content: string;
  sourceRef?: string;
  provenance?: SourceProvenanceInput;
  evidence: SourceEvidenceInput[];
  suggestedObjectTypes?: AttackKbStorageObjectType[];
  tags?: string[];
};

export type AttackKbIngestionOptions = {
  storage?: AttackKbStorageAdapter;
  now?: Date;
  trace?: boolean;
};

export type AttackKbIngestionResult<TObjectType extends "source_artifact" | "ingested_data_item"> = {
  ingestionId: string;
  ingestedAt: string;
  storage: {
    adapter: string;
    backend: AttackKbStorageAdapter["backend"];
  };
  object: AttackKbCanonicalObject<TObjectType>;
  curationCandidate: CurationCandidate;
  curationFlow: CurationFlowEvent;
  weaveTrace: "enabled" | "disabled_missing_wandb_api_key" | "disabled_custom_options" | "disabled_by_caller";
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stableOrRandomId(prefix: string, title: string, explicitId?: string): string {
  return explicitId ?? `${prefix}-${slugify(title) || randomUUID()}`;
}

function assertSupportedSourceCategory(category: AttackKbSourceCategory): void {
  if (!ATTACK_KB_SOURCE_CATEGORIES.includes(category)) {
    throw new Error(
      `Unsupported Attack KB source category: ${category}. Supported categories: ${ATTACK_KB_SOURCE_CATEGORIES.join(", ")}`,
    );
  }
}

function normalizeEvidence(evidence: SourceEvidenceInput[], now: Date): SourceEvidence[] {
  if (evidence.length === 0) {
    throw new Error("Attack KB ingestion requires at least one evidence item.");
  }

  return evidence.map((item) => ({
    summary: item.summary,
    excerpt: item.excerpt,
    locator: item.locator,
    confidence: item.confidence,
    observedAt: item.observedAt ?? now.toISOString(),
  }));
}

function buildProvenance(
  input: {
    title: string;
    category: AttackKbSourceCategory;
    url?: string;
    provenance?: SourceProvenanceInput;
  },
  now: Date,
): SourceProvenance {
  return {
    category: input.category,
    originLabel: input.provenance?.originLabel ?? input.title,
    publisher: input.provenance?.publisher,
    url: input.provenance?.url ?? input.url,
    retrievedAt: input.provenance?.retrievedAt ?? now.toISOString(),
    retrievedBy: input.provenance?.retrievedBy ?? "manual",
    sourceVersion: input.provenance?.sourceVersion,
    standardsRefs: input.provenance?.standardsRefs ?? [input.category],
    license: input.provenance?.license,
  };
}

function storageSummary(storage: AttackKbStorageAdapter): AttackKbIngestionResult<"source_artifact">["storage"] {
  return {
    adapter: storage.name,
    backend: storage.backend,
  };
}

function buildSourceObject(
  input: AttackKbSourceIngestionInput,
  now: Date,
): AttackKbCanonicalObject<"source_artifact"> {
  assertSupportedSourceCategory(input.category);
  const id = stableOrRandomId("source", input.title, input.id);
  const evidence = normalizeEvidence(input.evidence, now);
  const provenance = buildProvenance(input, now);
  const payload: SourceArtifact = {
    id,
    title: input.title,
    sourceType: input.sourceType ?? "standard",
    category: input.category,
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
    tags: ["ingested-source", input.category, ...provenance.standardsRefs, ...(input.tags ?? [])],
    payload,
  };
}

function buildDataItemObject(
  input: AttackKbDataItemIngestionInput,
  now: Date,
): AttackKbCanonicalObject<"ingested_data_item"> {
  assertSupportedSourceCategory(input.category);
  const id = stableOrRandomId("data", input.title, input.id);
  const evidence = normalizeEvidence(input.evidence, now);
  const provenance = buildProvenance(input, now);
  const payload: IngestedDataItem = {
    id,
    title: input.title,
    dataType: input.dataType,
    sourceRef: input.sourceRef,
    content: input.content,
    provenance,
    evidence,
  };

  return {
    id,
    objectType: "ingested_data_item",
    title: input.title,
    description: input.content.slice(0, 240),
    version: 1,
    updatedAt: now.toISOString(),
    sourceRefs: input.sourceRef ? [input.sourceRef] : [],
    tags: ["ingested-data", input.category, ...provenance.standardsRefs, ...(input.tags ?? [])],
    payload,
  };
}

async function ingestSourceUntraced(
  input: AttackKbSourceIngestionInput,
  options: AttackKbIngestionOptions = {},
  weaveTrace: AttackKbIngestionResult<"source_artifact">["weaveTrace"],
): Promise<AttackKbIngestionResult<"source_artifact">> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const now = options.now ?? new Date();
  const object = buildSourceObject(input, now);

  await storage.put(object);

  const { candidate, curationFlow } = await enqueueCurationCandidate(
    {
      candidateType: "source_artifact",
      objectRef: { id: object.id, storageType: "source_artifact" },
      sourceCategory: input.category,
      reason:
        "New source artifact was ingested and needs review before facts, vulnerabilities, attack patterns, or evidence-source records are promoted into the canonical KB.",
      evidence: object.payload.evidence,
      triggeredBy: "source_ingestion",
      suggestedObjectTypes: input.suggestedObjectTypes,
      createdAt: now,
    },
    { storage },
  );

  return {
    ingestionId: `ingest-${randomUUID()}`,
    ingestedAt: now.toISOString(),
    storage: storageSummary(storage),
    object,
    curationCandidate: candidate,
    curationFlow,
    weaveTrace,
  };
}

async function ingestDataItemUntraced(
  input: AttackKbDataItemIngestionInput,
  options: AttackKbIngestionOptions = {},
  weaveTrace: AttackKbIngestionResult<"ingested_data_item">["weaveTrace"],
): Promise<AttackKbIngestionResult<"ingested_data_item">> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const now = options.now ?? new Date();
  const object = buildDataItemObject(input, now);

  await storage.put(object);

  const { candidate, curationFlow } = await enqueueCurationCandidate(
    {
      candidateType: "ingested_data_item",
      objectRef: { id: object.id, storageType: "ingested_data_item" },
      sourceCategory: input.category,
      reason:
        "New data item was ingested and needs review before it becomes canonical Attack KB content.",
      evidence: object.payload.evidence,
      triggeredBy: "data_item_ingestion",
      suggestedObjectTypes: input.suggestedObjectTypes,
      createdAt: now,
    },
    { storage },
  );

  return {
    ingestionId: `ingest-${randomUUID()}`,
    ingestedAt: now.toISOString(),
    storage: storageSummary(storage),
    object,
    curationCandidate: candidate,
    curationFlow,
    weaveTrace,
  };
}

const ingestAttackKbSourceOp = weave.op(async function ingestAttackKbSource(
  input: AttackKbSourceIngestionInput,
): Promise<AttackKbIngestionResult<"source_artifact">> {
  return ingestSourceUntraced(input, {}, "enabled");
});

const ingestAttackKbDataItemOp = weave.op(async function ingestAttackKbDataItem(
  input: AttackKbDataItemIngestionInput,
): Promise<AttackKbIngestionResult<"ingested_data_item">> {
  return ingestDataItemUntraced(input, {}, "enabled");
});

function traceState(options: AttackKbIngestionOptions): AttackKbIngestionResult<"source_artifact">["weaveTrace"] {
  if (options.trace === false) {
    return "disabled_by_caller";
  }

  if (options.storage || options.now) {
    return "disabled_custom_options";
  }

  if (!process.env.WANDB_API_KEY?.trim()) {
    return "disabled_missing_wandb_api_key";
  }

  return "enabled";
}

export async function ingestAttackKbSource(
  input: AttackKbSourceIngestionInput,
  options: AttackKbIngestionOptions = {},
): Promise<AttackKbIngestionResult<"source_artifact">> {
  const trace = traceState(options);

  if (trace === "enabled") {
    await initWeave();
    return ingestAttackKbSourceOp(input);
  }

  return ingestSourceUntraced(input, options, trace);
}

export async function ingestAttackKbDataItem(
  input: AttackKbDataItemIngestionInput,
  options: AttackKbIngestionOptions = {},
): Promise<AttackKbIngestionResult<"ingested_data_item">> {
  const trace = traceState(options);

  if (trace === "enabled") {
    await initWeave();
    return ingestAttackKbDataItemOp(input);
  }

  return ingestDataItemUntraced(input, options, trace);
}
