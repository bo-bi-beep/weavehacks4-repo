import { randomUUID } from "node:crypto";

import { getDefaultAttackKbStorageAdapter, type AttackKbStorageAdapter } from "../storage/index.js";
import type {
  AttackKbCanonicalObject,
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  CurationCandidate,
  SourceEvidence,
} from "../types.js";

export type CurationCandidateInput = {
  candidateType: CurationCandidate["candidateType"];
  objectRef: CurationCandidate["objectRef"];
  sourceCategory: AttackKbSourceCategory;
  reason: string;
  evidence: SourceEvidence[];
  triggeredBy: CurationCandidate["triggeredBy"];
  suggestedObjectTypes?: AttackKbStorageObjectType[];
  createdAt?: Date;
};

export type CurationFlowEvent = {
  candidateId: string;
  firedAt: string;
  queue: "manual_review_queue";
  status: "review_required";
  message: string;
};

export type EnqueueCurationCandidateOptions = {
  storage?: AttackKbStorageAdapter;
  candidateId?: string;
};

const DEFAULT_SOURCE_SUGGESTIONS: AttackKbStorageObjectType[] = [
  "vulnerability",
  "attack_pattern",
  "system_attack_pattern",
  "evidence_source",
];

const DEFAULT_DATA_ITEM_SUGGESTIONS: AttackKbStorageObjectType[] = [
  "vulnerability",
  "attack_pattern",
  "payload_template",
  "success_signal",
];

function defaultSuggestedObjectTypes(candidateType: CurationCandidate["candidateType"]): AttackKbStorageObjectType[] {
  return candidateType === "source_artifact" ? DEFAULT_SOURCE_SUGGESTIONS : DEFAULT_DATA_ITEM_SUGGESTIONS;
}

function buildCandidateObject(candidate: CurationCandidate): AttackKbCanonicalObject<"curation_candidate"> {
  return {
    id: candidate.id,
    objectType: "curation_candidate",
    title: `Curation candidate for ${candidate.objectRef.id}`,
    description: candidate.reason,
    version: 1,
    updatedAt: candidate.createdAt,
    sourceRefs: [candidate.objectRef.id],
    tags: ["curation", "review-required", candidate.sourceCategory, candidate.candidateType],
    payload: candidate,
  };
}

export function fireCurationFlow(candidate: CurationCandidate): CurationFlowEvent {
  return {
    candidateId: candidate.id,
    firedAt: candidate.curationFlow.firedAt,
    queue: candidate.curationFlow.flow,
    status: "review_required",
    message:
      "Curation flow fired: candidate is queued for human/agent review before promotion into canonical Attack KB objects.",
  };
}

export async function enqueueCurationCandidate(
  input: CurationCandidateInput,
  options: EnqueueCurationCandidateOptions = {},
): Promise<{ candidate: CurationCandidate; curationFlow: CurationFlowEvent }> {
  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const createdAt = input.createdAt ?? new Date();
  const firedAt = createdAt.toISOString();
  const candidate: CurationCandidate = {
    id: options.candidateId ?? `curation-${randomUUID()}`,
    candidateType: input.candidateType,
    objectRef: input.objectRef,
    sourceCategory: input.sourceCategory,
    status: "review_required",
    reason: input.reason,
    suggestedObjectTypes: input.suggestedObjectTypes ?? defaultSuggestedObjectTypes(input.candidateType),
    evidence: input.evidence,
    createdAt: createdAt.toISOString(),
    triggeredBy: input.triggeredBy,
    curationFlow: {
      flow: "manual_review_queue",
      firedAt,
      status: "fired",
      notes: [
        "No LLM call was made for this queue primitive.",
        "Reviewer should map the item into canonical KB objects or reject it with rationale.",
      ],
    },
  };

  await storage.put(buildCandidateObject(candidate));

  return {
    candidate,
    curationFlow: fireCurationFlow(candidate),
  };
}
