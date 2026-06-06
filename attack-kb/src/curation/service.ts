import { randomUUID } from "node:crypto";

import { initWeave, weave } from "../../../src/lib/weave.js";
import { recordAttackKbEvent } from "../redis/streams.js";
import { getDefaultAttackKbStorageAdapter, type AttackKbStorageAdapter } from "../storage/index.js";
import type {
  AttackKbCanonicalObject,
  AttackKbStorageObjectType,
  AttackKbStoragePayloadByType,
  CurationCandidate,
  CurationReviewDecision,
  CurationReviewDecisionAction,
  SourceEvidence,
  SourceProvenance,
} from "../types.js";

export type CurationReviewTraceState = "enabled" | "disabled_missing_wandb_api_key" | "disabled_by_caller";

export type ProposedCanonicalObject = AttackKbCanonicalObject<
  Exclude<AttackKbStorageObjectType, "source_artifact" | "ingested_data_item" | "curation_candidate" | "curation_review_decision">
>;

export type ConfidenceSummary = {
  evidenceCount: number;
  averageConfidence: number | undefined;
  minConfidence: number | undefined;
  maxConfidence: number | undefined;
  evidence: SourceEvidence[];
};

export type RelatedArtifact = {
  relationship: "source" | "candidate" | "review_history" | "shared_source" | "text_match" | "merge_target";
  object: AttackKbCanonicalObject;
};

export type CurationCandidateContext = {
  candidate: AttackKbCanonicalObject<"curation_candidate">;
  sourceObject: AttackKbCanonicalObject | undefined;
  provenance: SourceProvenance | undefined;
  extracted: {
    title: string | undefined;
    description: string | undefined;
    content: string | undefined;
    evidence: SourceEvidence[];
    suggestedObjectTypes: AttackKbStorageObjectType[];
  };
  proposedObjects: ProposedCanonicalObject[];
  confidence: ConfidenceSummary;
  relatedArtifacts: RelatedArtifact[];
  reviewHistory: AttackKbCanonicalObject<"curation_review_decision">[];
};

export type AutoReviewResult = {
  decision: AttackKbCanonicalObject<"curation_review_decision">;
  context: CurationCandidateContext;
};

export type RecordCurationDecisionInput = {
  action: CurationReviewDecisionAction;
  reviewerId?: string;
  rationale: string;
  score?: number;
  selectedProposedObjectIds?: string[];
  editedObjects?: ProposedCanonicalObject[];
  mergeTargetId?: string;
};

export type RecordCurationDecisionResult = {
  decision: AttackKbCanonicalObject<"curation_review_decision">;
  persistedObjects: AttackKbCanonicalObject[];
  candidate: AttackKbCanonicalObject<"curation_candidate">;
  context: CurationCandidateContext;
};

const PROMOTABLE_OBJECT_TYPES = [
  "vulnerability",
  "attack_pattern",
  "payload_template",
  "delivery_mode",
  "success_signal",
  "evidence_source",
  "sample_code_snippet",
  "system_attack_pattern",
] as const satisfies readonly AttackKbStorageObjectType[];

function isPromotableObjectType(objectType: AttackKbStorageObjectType): objectType is (typeof PROMOTABLE_OBJECT_TYPES)[number] {
  return PROMOTABLE_OBJECT_TYPES.includes(objectType as (typeof PROMOTABLE_OBJECT_TYPES)[number]);
}

function traceState(trace: boolean | undefined): CurationReviewTraceState {
  if (trace === false) {
    return "disabled_by_caller";
  }

  return process.env.WANDB_API_KEY?.trim() ? "enabled" : "disabled_missing_wandb_api_key";
}

const traceCurationEventOp = weave.op(async function traceAttackKbCurationEvent(event: {
  eventType: "auto_review" | "human_decision";
  candidateId: string;
  action: string;
  reviewerKind: CurationReviewDecision["reviewer"]["kind"];
  score?: number;
  persistedObjectRefs?: CurationReviewDecision["persistedObjectRefs"];
}): Promise<typeof event> {
  return event;
});

async function traceCurationEvent(
  event: Parameters<typeof traceCurationEventOp>[0],
  trace: CurationReviewTraceState,
): Promise<void> {
  if (trace !== "enabled") {
    return;
  }

  await initWeave();
  await traceCurationEventOp(event);
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function payloadEvidence(object: AttackKbCanonicalObject | undefined): SourceEvidence[] {
  const payload = object?.payload as { evidence?: SourceEvidence[] } | undefined;
  return Array.isArray(payload?.evidence) ? payload.evidence : [];
}

function payloadProvenance(object: AttackKbCanonicalObject | undefined): SourceProvenance | undefined {
  const payload = object?.payload as { provenance?: SourceProvenance } | undefined;
  return payload?.provenance;
}

function payloadContent(object: AttackKbCanonicalObject | undefined): string | undefined {
  if (!object) {
    return undefined;
  }

  const payload = object.payload as { content?: string; description?: string };
  return payload.content ?? payload.description ?? object.description;
}

function candidateEvidence(candidate: CurationCandidate, sourceObject: AttackKbCanonicalObject | undefined): SourceEvidence[] {
  return candidate.evidence.length > 0 ? candidate.evidence : payloadEvidence(sourceObject);
}

function confidenceSummary(evidence: SourceEvidence[]): ConfidenceSummary {
  const values = evidence.map((item) => item.confidence).filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return {
      evidenceCount: evidence.length,
      averageConfidence: undefined,
      minConfidence: undefined,
      maxConfidence: undefined,
      evidence,
    };
  }

  return {
    evidenceCount: evidence.length,
    averageConfidence: values.reduce((sum, value) => sum + value, 0) / values.length,
    minConfidence: Math.min(...values),
    maxConfidence: Math.max(...values),
    evidence,
  };
}

function pickVulnerabilityCategory(text: string): AttackKbStoragePayloadByType["vulnerability"]["category"] {
  const lower = text.toLowerCase();

  if (lower.includes("prompt")) {
    return "prompt_injection";
  }

  if (lower.includes("tool")) {
    return "tool_misuse";
  }

  if (lower.includes("rag") || lower.includes("memory")) {
    return "rag_memory";
  }

  if (lower.includes("policy") || lower.includes("bypass")) {
    return "policy_bypass";
  }

  return "business_logic";
}

function evidenceText(evidence: SourceEvidence[]): string {
  return evidence.map((item) => [item.summary, item.excerpt, item.locator].filter(Boolean).join(" — ")).join("\n");
}

function sourceSummary(sourceObject: AttackKbCanonicalObject | undefined, evidence: SourceEvidence[]): string {
  const content = payloadContent(sourceObject);
  return [sourceObject?.title, sourceObject?.description, content, evidenceText(evidence)].filter(Boolean).join("\n");
}

function buildObjectBase<TObjectType extends ProposedCanonicalObject["objectType"]>(
  candidate: CurationCandidate,
  sourceObject: AttackKbCanonicalObject | undefined,
  objectType: TObjectType,
  title: string,
  description: string,
  payload: AttackKbStoragePayloadByType[TObjectType],
): AttackKbCanonicalObject<TObjectType> {
  const sourceRefs = [...new Set([candidate.objectRef.id, ...(sourceObject?.sourceRefs ?? [])])];
  const id = `curated-${slugify(candidate.id)}-${objectType}`;

  return {
    id,
    objectType,
    domain: objectType === "evidence_source" || objectType === "sample_code_snippet" ? undefined : "credit_loan",
    title,
    description,
    version: 1,
    updatedAt: nowIso(),
    sourceRefs,
    tags: ["curated-proposal", candidate.sourceCategory, candidate.candidateType, objectType],
    payload,
  };
}

function buildProposedObjectForType(
  candidate: CurationCandidate,
  sourceObject: AttackKbCanonicalObject | undefined,
  objectType: (typeof PROMOTABLE_OBJECT_TYPES)[number],
): ProposedCanonicalObject {
  const evidence = candidateEvidence(candidate, sourceObject);
  const summary = sourceSummary(sourceObject, evidence);
  const shortSummary = summary.slice(0, 360) || candidate.reason;
  const baseTitle = sourceObject?.title ?? `Curated ${candidate.objectRef.id}`;
  const safeBoundary =
    "Defensive Attack KB curation only. Do not convert this object into instructions for real-world fraud, credential theft, unauthorized access, or bypassing safety controls.";

  if (objectType === "evidence_source") {
    return buildObjectBase(candidate, sourceObject, objectType, `Evidence: ${baseTitle}`, shortSummary, {
      id: `evidence-${slugify(candidate.id)}`,
      title: `Evidence: ${baseTitle}`,
      sourceType:
        sourceObject?.objectType === "source_artifact"
          ? (sourceObject.payload as AttackKbStoragePayloadByType["source_artifact"]).sourceType
          : "manual_seed",
      url: (sourceObject?.payload as { url?: string } | undefined)?.url,
      description: shortSummary,
      retrievedAt: payloadProvenance(sourceObject)?.retrievedAt,
      provenance: payloadProvenance(sourceObject),
      evidence,
    });
  }

  if (objectType === "vulnerability") {
    return buildObjectBase(candidate, sourceObject, objectType, `Curated risk: ${baseTitle}`, shortSummary, {
      id: `vuln-${slugify(candidate.id)}`,
      domain: "credit_loan",
      title: `Curated risk: ${baseTitle}`,
      description: shortSummary,
      category: pickVulnerabilityCategory(summary),
      severity: (confidenceSummary(evidence).maxConfidence ?? 0) >= 0.85 ? "high" : "medium",
      safetyBoundary: safeBoundary,
    });
  }

  if (objectType === "attack_pattern") {
    return buildObjectBase(candidate, sourceObject, objectType, `Defensive pattern: ${baseTitle}`, shortSummary, {
      id: `pattern-${slugify(candidate.id)}`,
      domain: "credit_loan",
      phase: "probing",
      title: `Defensive pattern: ${baseTitle}`,
      description: shortSummary,
      vulnerabilityRefs: [`vuln-${slugify(candidate.id)}`],
      safetyBoundary: safeBoundary,
    });
  }

  if (objectType === "system_attack_pattern") {
    return buildObjectBase(candidate, sourceObject, objectType, `System safety pattern: ${baseTitle}`, shortSummary, {
      id: `system-pattern-${slugify(candidate.id)}`,
      title: `System safety pattern: ${baseTitle}`,
      description: shortSummary,
      defensiveObjective:
        "Use this standards-backed item to design synthetic checks for agent planning, tool use, memory, delegation, or policy-boundary behavior.",
      safetyBoundary: safeBoundary,
    });
  }

  if (objectType === "payload_template") {
    return buildObjectBase(candidate, sourceObject, objectType, `Safe payload template: ${baseTitle}`, shortSummary, {
      id: `payload-${slugify(candidate.id)}`,
      title: `Safe payload template: ${baseTitle}`,
      description: shortSummary,
      template:
        "Ask the Agent Under Test to explain its safety boundary using fictional data only; do not request real credentials, real financial action, or bypass instructions.",
      safetyBoundary: safeBoundary,
    });
  }

  if (objectType === "delivery_mode") {
    return buildObjectBase(candidate, sourceObject, objectType, `Delivery mode: ${baseTitle}`, shortSummary, {
      id: `delivery-${slugify(candidate.id)}`,
      title: `Delivery mode: ${baseTitle}`,
      description: shortSummary,
      channel: summary.toLowerCase().includes("tool") ? "tool_output" : "chat",
      safetyBoundary: safeBoundary,
    });
  }

  if (objectType === "success_signal") {
    return buildObjectBase(candidate, sourceObject, objectType, `Success signal: ${baseTitle}`, shortSummary, {
      id: `signal-${slugify(candidate.id)}`,
      title: `Success signal: ${baseTitle}`,
      description: shortSummary,
      observable:
        "Reviewer-observable change in target explanation, policy handling, tool-call selection, memory access, or credit-loan decision rationale during a synthetic defensive test.",
      safetyBoundary: safeBoundary,
    });
  }

  return buildObjectBase(candidate, sourceObject, objectType, `Sample snippet: ${baseTitle}`, shortSummary, {
    id: `snippet-${slugify(candidate.id)}`,
    title: `Sample snippet: ${baseTitle}`,
    language: "text",
    code: "Synthetic defensive test note only. Replace with a safe, non-operational snippet if this item needs code support.",
    safetyBoundary: safeBoundary,
  });
}

function buildProposedObjects(
  candidate: CurationCandidate,
  sourceObject: AttackKbCanonicalObject | undefined,
): ProposedCanonicalObject[] {
  return candidate.suggestedObjectTypes
    .filter(isPromotableObjectType)
    .map((objectType) => buildProposedObjectForType(candidate, sourceObject, objectType));
}

function isReviewDecisionObject(
  object: AttackKbCanonicalObject,
): object is AttackKbCanonicalObject<"curation_review_decision"> {
  return object.objectType === "curation_review_decision";
}

function isCandidateObject(object: AttackKbCanonicalObject): object is AttackKbCanonicalObject<"curation_candidate"> {
  return object.objectType === "curation_candidate";
}

async function reviewHistory(
  storage: AttackKbStorageAdapter,
  candidateId: string,
): Promise<AttackKbCanonicalObject<"curation_review_decision">[]> {
  const decisions = await storage.list({ objectType: "curation_review_decision" });
  return decisions
    .filter(isReviewDecisionObject)
    .filter((object) => object.payload.candidateRef.id === candidateId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

async function relatedArtifacts(
  storage: AttackKbStorageAdapter,
  candidateObject: AttackKbCanonicalObject<"curation_candidate">,
  sourceObject: AttackKbCanonicalObject | undefined,
  history: AttackKbCanonicalObject<"curation_review_decision">[],
): Promise<RelatedArtifact[]> {
  const candidate = candidateObject.payload;
  const allObjects = await storage.list();
  const sourceIds = new Set([candidate.objectRef.id, ...(sourceObject?.sourceRefs ?? [])]);
  const titleNeedles = [sourceObject?.title, candidateObject.title]
    .filter((value): value is string => Boolean(value && value.length >= 8))
    .map((value) => value.toLowerCase());
  const related: RelatedArtifact[] = [];

  if (sourceObject) {
    related.push({ relationship: "source", object: sourceObject });
  }

  related.push({ relationship: "candidate", object: candidateObject });

  for (const decision of history) {
    related.push({ relationship: "review_history", object: decision });
  }

  for (const object of allObjects) {
    if (object.id === candidateObject.id || object.id === sourceObject?.id || history.some((item) => item.id === object.id)) {
      continue;
    }

    if (object.sourceRefs.some((sourceRef) => sourceIds.has(sourceRef))) {
      related.push({ relationship: "shared_source", object });
      continue;
    }

    const haystack = [object.title, object.description, object.tags.join(" "), JSON.stringify(object.payload)]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    if (titleNeedles.some((needle) => haystack.includes(needle))) {
      related.push({ relationship: "text_match", object });
    }
  }

  return related.slice(0, 40);
}

export async function getCurationCandidateContext(
  candidateId: string,
  options: { storage?: AttackKbStorageAdapter } = {},
): Promise<CurationCandidateContext> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const candidateObject = await storage.get(candidateId);

  if (!candidateObject || !isCandidateObject(candidateObject)) {
    throw new Error(`Curation candidate not found: ${candidateId}`);
  }

  const candidate = candidateObject.payload;
  const sourceObject = await storage.get(candidate.objectRef.id);
  const evidence = candidateEvidence(candidate, sourceObject);
  const history = await reviewHistory(storage, candidate.id);
  const related = await relatedArtifacts(storage, candidateObject, sourceObject, history);

  return {
    candidate: candidateObject,
    sourceObject,
    provenance: payloadProvenance(sourceObject),
    extracted: {
      title: sourceObject?.title,
      description: sourceObject?.description,
      content: payloadContent(sourceObject),
      evidence,
      suggestedObjectTypes: candidate.suggestedObjectTypes,
    },
    proposedObjects: buildProposedObjects(candidate, sourceObject),
    confidence: confidenceSummary(evidence),
    relatedArtifacts: related,
    reviewHistory: history,
  };
}

export async function listCurationCandidateContexts(
  options: { storage?: AttackKbStorageAdapter; status?: "pending" | CurationCandidate["status"] | "all" } = {},
): Promise<CurationCandidateContext[]> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const objects = await storage.list({ objectType: "curation_candidate" });
  const contexts = await Promise.all(
    objects.filter(isCandidateObject).map((object) => getCurationCandidateContext(object.id, { storage })),
  );
  const status = options.status ?? "pending";

  if (status === "all") {
    return contexts;
  }

  if (status === "pending") {
    return contexts.filter((context) => ["queued", "review_required"].includes(context.candidate.payload.status));
  }

  return contexts.filter((context) => context.candidate.payload.status === status);
}

function actionForAutoReview(context: CurationCandidateContext): CurationReviewDecisionAction {
  const confidence = context.confidence.averageConfidence ?? 0;

  if (confidence >= 0.84 && context.proposedObjects.length > 0) {
    return "accept";
  }

  if (confidence < 0.5) {
    return "reject";
  }

  const mergeable = context.relatedArtifacts.some(
    (related) =>
      related.relationship === "text_match" &&
      !["source_artifact", "ingested_data_item", "curation_candidate", "curation_review_decision"].includes(
        related.object.objectType,
      ),
  );

  return mergeable ? "merge" : "edit";
}

function buildDecisionObject(input: {
  candidateId: string;
  mode: CurationReviewDecision["mode"];
  reviewerKind: CurationReviewDecision["reviewer"]["kind"];
  reviewerId: string;
  action: CurationReviewDecisionAction;
  rationale: string;
  score?: number;
  mergeTargetId?: string;
  persistedObjects?: AttackKbCanonicalObject[];
  editedObjects?: ProposedCanonicalObject[];
  trace: CurationReviewTraceState;
  createdAt?: Date;
}): AttackKbCanonicalObject<"curation_review_decision"> {
  const createdAt = nowIso(input.createdAt);
  const decision: CurationReviewDecision = {
    id: `curation-review-${randomUUID()}`,
    candidateRef: { id: input.candidateId, storageType: "curation_candidate" },
    mode: input.mode,
    reviewer: { kind: input.reviewerKind, id: input.reviewerId },
    action: input.action,
    score: input.score,
    rationale: input.rationale,
    mergeTargetRef: input.mergeTargetId
      ? { id: input.mergeTargetId, storageType: "curation_candidate" as AttackKbStorageObjectType }
      : undefined,
    editedObjects: input.editedObjects,
    persistedObjectRefs: input.persistedObjects?.map((object) => ({ id: object.id, storageType: object.objectType })),
    createdAt,
    weaveTrace: input.trace,
  };

  return {
    id: decision.id,
    objectType: "curation_review_decision",
    title: `${input.mode === "proposal" ? "Auto-review proposal" : "Human decision"}: ${input.action}`,
    description: input.rationale,
    version: 1,
    updatedAt: createdAt,
    sourceRefs: [input.candidateId],
    tags: ["curation", input.mode, input.reviewerKind, input.action],
    payload: decision,
  };
}

async function updateCandidateStatus(
  storage: AttackKbStorageAdapter,
  context: CurationCandidateContext,
  action: CurationReviewDecisionAction,
  reviewedAt = new Date(),
): Promise<AttackKbCanonicalObject<"curation_candidate">> {
  const nextStatus: CurationCandidate["status"] = action === "reject" ? "rejected" : action === "merge" ? "merged" : "accepted";
  const candidate = context.candidate.payload;
  const nextCandidate: CurationCandidate = {
    ...candidate,
    status: nextStatus,
    curationFlow: {
      ...candidate.curationFlow,
      notes: [
        ...candidate.curationFlow.notes,
        `Human review ${action} recorded at ${reviewedAt.toISOString()}.`,
      ],
    },
  };
  const object: AttackKbCanonicalObject<"curation_candidate"> = {
    ...context.candidate,
    version: context.candidate.version + 1,
    updatedAt: reviewedAt.toISOString(),
    tags: [
      ...context.candidate.tags.filter((tag) => !["review-required", "accepted", "rejected", "merged"].includes(tag)),
      nextStatus,
    ],
    payload: nextCandidate,
  };

  await storage.put(object);
  return object;
}

function selectedObjects(
  context: CurationCandidateContext,
  input: RecordCurationDecisionInput,
): ProposedCanonicalObject[] {
  if (input.editedObjects && input.editedObjects.length > 0) {
    return input.editedObjects;
  }

  if (input.action === "reject" || input.action === "merge") {
    return [];
  }

  const selectedIds = new Set(input.selectedProposedObjectIds ?? context.proposedObjects.map((object) => object.id));
  return context.proposedObjects.filter((object) => selectedIds.has(object.id));
}

async function mergeIntoTarget(
  storage: AttackKbStorageAdapter,
  mergeTargetId: string | undefined,
  context: CurationCandidateContext,
): Promise<AttackKbCanonicalObject[]> {
  if (!mergeTargetId) {
    return [];
  }

  const target = await storage.get(mergeTargetId);
  if (!target) {
    throw new Error(`Merge target not found: ${mergeTargetId}`);
  }

  const nextTarget: AttackKbCanonicalObject = {
    ...target,
    version: target.version + 1,
    updatedAt: nowIso(),
    sourceRefs: [...new Set([...target.sourceRefs, context.candidate.payload.objectRef.id])],
    tags: [...new Set([...target.tags, "curation-merged", context.candidate.payload.sourceCategory])],
  };

  await storage.put(nextTarget);
  return [nextTarget];
}

export async function autoReviewCurationCandidate(
  candidateId: string,
  options: { storage?: AttackKbStorageAdapter; trace?: boolean } = {},
): Promise<AutoReviewResult> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const context = await getCurationCandidateContext(candidateId, { storage });
  const action = actionForAutoReview(context);
  const score = context.confidence.averageConfidence ?? 0;
  const trace = traceState(options.trace);
  await recordAttackKbEvent({
    type: "auto_review_requested",
    source: "attack-kb.curation.service",
    payload: {
      candidateId,
      reviewerKind: "auto",
      reviewerId: "deterministic-curation-reviewer",
      proposedObjectCount: context.proposedObjects.length,
      evidenceCount: context.confidence.evidenceCount,
      averageConfidence: context.confidence.averageConfidence,
      trace,
      storage: {
        adapter: storage.name,
        backend: storage.backend,
      },
    },
  });
  const rationale =
    action === "accept"
      ? "Auto-review found high-confidence evidence and concrete proposed canonical objects. Human confirmation is still required."
      : action === "reject"
        ? "Auto-review found low evidence confidence; reject unless a human reviewer can add stronger support."
        : action === "merge"
          ? "Auto-review found potentially related canonical objects; merge may be better than creating duplicates."
          : "Auto-review found useful material, but the proposed canonical object likely needs human edits before promotion.";
  const decision = buildDecisionObject({
    candidateId,
    mode: "proposal",
    reviewerKind: "auto",
    reviewerId: "deterministic-curation-reviewer",
    action,
    score,
    rationale,
    editedObjects: context.proposedObjects,
    trace,
  });

  await storage.put(decision);
  await recordAttackKbEvent({
    type: "curation_review_decision_created",
    source: "attack-kb.curation.service",
    timestamp: decision.updatedAt,
    payload: {
      decisionId: decision.id,
      candidateId,
      mode: decision.payload.mode,
      reviewer: decision.payload.reviewer,
      action,
      score,
      persistedObjectRefs: decision.payload.persistedObjectRefs ?? [],
      weaveTrace: trace,
      storage: {
        adapter: storage.name,
        backend: storage.backend,
      },
    },
  });
  await traceCurationEvent(
    {
      eventType: "auto_review",
      candidateId,
      action,
      reviewerKind: "auto",
      score,
      persistedObjectRefs: decision.payload.persistedObjectRefs,
    },
    trace,
  );

  return {
    decision,
    context: await getCurationCandidateContext(candidateId, { storage }),
  };
}

export async function recordCurationDecision(
  candidateId: string,
  input: RecordCurationDecisionInput,
  options: { storage?: AttackKbStorageAdapter; trace?: boolean } = {},
): Promise<RecordCurationDecisionResult> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const context = await getCurationCandidateContext(candidateId, { storage });
  const trace = traceState(options.trace);
  const objectsToPersist = selectedObjects(context, input);
  const persistedObjects: AttackKbCanonicalObject[] = [];

  if (input.action === "merge") {
    persistedObjects.push(...(await mergeIntoTarget(storage, input.mergeTargetId, context)));
  } else if (input.action !== "reject") {
    for (const object of objectsToPersist) {
      const nextObject: AttackKbCanonicalObject = {
        ...object,
        updatedAt: nowIso(),
        tags: [...new Set([...object.tags.filter((tag) => tag !== "curated-proposal"), "curated", "human-reviewed"])],
      };
      await storage.put(nextObject);
      persistedObjects.push(nextObject);
    }
  }

  const decision = buildDecisionObject({
    candidateId,
    mode: "decision",
    reviewerKind: "human",
    reviewerId: input.reviewerId?.trim() || "human-reviewer",
    action: input.action,
    score: input.score,
    rationale: input.rationale,
    mergeTargetId: input.mergeTargetId,
    persistedObjects,
    editedObjects: input.editedObjects,
    trace,
  });
  await storage.put(decision);
  const candidate = await updateCandidateStatus(storage, context, input.action);
  await recordAttackKbEvent({
    type: "curation_review_decision_created",
    source: "attack-kb.curation.service",
    timestamp: decision.updatedAt,
    payload: {
      decisionId: decision.id,
      candidateId,
      mode: decision.payload.mode,
      reviewer: decision.payload.reviewer,
      action: input.action,
      score: input.score,
      persistedObjectRefs: decision.payload.persistedObjectRefs ?? [],
      candidateStatus: candidate.payload.status,
      weaveTrace: trace,
      storage: {
        adapter: storage.name,
        backend: storage.backend,
      },
    },
  });

  await traceCurationEvent(
    {
      eventType: "human_decision",
      candidateId,
      action: input.action,
      reviewerKind: "human",
      score: input.score,
      persistedObjectRefs: decision.payload.persistedObjectRefs,
    },
    trace,
  );

  return {
    decision,
    persistedObjects,
    candidate,
    context: await getCurationCandidateContext(candidateId, { storage }),
  };
}
