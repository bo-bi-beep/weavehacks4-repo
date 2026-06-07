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

export type CuratedSourceArtifactInput = {
  id?: string;
  title: string;
  description: string;
  category: AttackKbSourceCategory;
  sourceType: EvidenceSourceType;
  url: string;
  provenance: SourceProvenance;
  evidence: SourceEvidence[];
  suggestedObjectTypes: AttackKbStorageObjectType[];
  tags: string[];
};

export type KbCuratorPacket = {
  runId: string;
  generatedAt: string;
  approvedSourceArtifacts: CuratedSourceArtifactInput[];
  rejectedCandidateUrls: string[];
  curatorNotes: string;
};

export type PersistedSourceArtifact = {
  id: string;
  objectType: "source_artifact";
  title: string;
  redisKey: string;
  contextProjectionKey?: string;
};
