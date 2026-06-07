import type {
  AttackKbSourceCategory,
  AttackKbStorageObjectType,
  EvidenceSourceType,
  SourceEvidence,
  SourceProvenance,
} from "../types.js";

export type SourceDiscoveryCandidate = {
  id?: string;
  title: string;
  url: string;
  publisher?: string;
  category: AttackKbSourceCategory;
  sourceType?: EvidenceSourceType;
  standardsRefs: string[];
  reason: string;
  expectedExtractionTargets: AttackKbStorageObjectType[];
  safetyNotes: string;
};

export type SourceDiscoveryPacket = {
  runId: string;
  generatedAt: string;
  mission: string;
  candidates: SourceDiscoveryCandidate[];
  spawnRetrievalForCandidateIds: string[];
  notes?: string;
};

export type SourceRetrievalPacket = {
  candidate: SourceDiscoveryCandidate;
  retrievedAt: string;
  retrievalStatus: "retrieved" | "partial" | "failed";
  provenance: SourceProvenance;
  description: string;
  evidence: SourceEvidence[];
  suggestedObjectTypes: AttackKbStorageObjectType[];
  tags: string[];
  retrievalNotes: string;
  safetyNotes: string;
};

export type SourceGatheringPacket = {
  runId: string;
  generatedAt: string;
  mission: string;
  retrievedSources: SourceRetrievalPacket[];
  discardedCandidates: Array<{
    title: string;
    url: string;
    reason: string;
  }>;
  notes?: string;
};

export type CredibilityTriageDecision = {
  candidateUrl: string;
  title: string;
  action: "accept" | "reject" | "needs_review";
  score: number;
  rationale: string;
  safetyNotes: string;
  requiredFixes: string[];
  approvedPacket?: SourceRetrievalPacket;
};

export type CredibilityTriagePacket = {
  runId: string;
  generatedAt: string;
  decisions: CredibilityTriageDecision[];
};

export const CURATED_DERIVED_OBJECT_TYPES = [
  "vulnerability",
  "attack_pattern",
  "system_attack_pattern",
  "evidence_source",
  "delivery_mode",
  "success_signal",
] as const satisfies readonly AttackKbStorageObjectType[];

export type CuratedDerivedObjectType = (typeof CURATED_DERIVED_OBJECT_TYPES)[number];

export type CuratedDerivedArtifactInput = {
  id: string;
  objectType: CuratedDerivedObjectType;
  domain?: "credit_loan";
  title: string;
  description: string;
  sourceRefs: string[];
  tags: string[];
  payload: Record<string, unknown>;
};

export type KbCuratorPacket = {
  runId: string;
  generatedAt: string;
  artifacts: CuratedDerivedArtifactInput[];
  rejectedCandidateUrls: string[];
  curatorNotes: string;
};

export type PersistedDerivedArtifact = {
  id: string;
  objectType: CuratedDerivedObjectType;
  title: string;
  redisKey: string;
  contextProjectionKey?: string;
};
