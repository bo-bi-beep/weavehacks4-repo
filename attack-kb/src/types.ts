export type AttackKbDomain = "credit_loan";

export type AttackPhase = "probing" | "attack" | "validation";

export type ObservedBehavior = {
  summary: string;
  evidence?: string;
  confidence?: number;
};

export type ObservedDecisionFactor = {
  factorRef: string;
  evidence: string;
  confidence: number;
};

export type AgentUnderTestProfile = {
  domain?: AttackKbDomain;
  techStack?: string[];
  modelStack?: string[];
  tools?: string[];
  memoryOrRag?: string[];
  permissions?: string[];
  policies?: string[];
  observedBehavior?: ObservedBehavior[];
  observedDecisionFactors?: ObservedDecisionFactor[];
};

export type DomainDecisionFactor = {
  id: string;
  domain: AttackKbDomain;
  name: "credit_score" | "income" | "existing_loans" | "previous_fraud_history";
  label: string;
  description: string;
  status: "likely_domain_factor" | "observed_target_factor";
};

export type ReconProbe = {
  id: string;
  domain: AttackKbDomain;
  title: string;
  description: string;
  factorRefs: string[];
  expectedFindings: string[];
  safetyBoundary: string;
};

export type DomainScenario = {
  id: string;
  domain: AttackKbDomain;
  title: string;
  description: string;
  decisionFactorRefs: string[];
  scenarioSignals: string[];
  expectedSafeObservation: string;
  safetyBoundary: string;
};

export type SystemAttackPattern = {
  id: string;
  title: string;
  description: string;
  defensiveObjective: string;
  safetyBoundary: string;
};

export type BusinessAttackRoute = {
  id: string;
  domain: AttackKbDomain;
  title: string;
  description: string;
  decisionFactorRefs: string[];
  scenarioRefs: string[];
  systemPatternRefs: string[];
  defensiveObjective: string;
  safetyBoundary: string;
};

export type MissingInfo = {
  key: string;
  reason: string;
  probeRefs: string[];
};

export type RecommendationComposition = {
  businessAttackRouteRefs: string[];
  domainScenarioRefs: string[];
  systemPatternRefs: string[];
  rationale: string;
};

export type AttackRecommendation = {
  id: string;
  phase: AttackPhase;
  title: string;
  whyRelevant: string;
  domainDecisionFactorRefs: string[];
  reconProbeRefs?: string[];
  businessAttackRouteRefs?: string[];
  domainScenarioRefs?: string[];
  systemPatternRefs?: string[];
  composition?: RecommendationComposition;
  expectedFindings?: string[];
  safetyBoundary: string;
};

export const ATTACK_KB_STORAGE_OBJECT_TYPES = [
  "domain_decision_factor",
  "recon_probe",
  "domain_scenario",
  "business_attack_route",
  "system_attack_pattern",
  "vulnerability",
  "attack_pattern",
  "payload_template",
  "delivery_mode",
  "success_signal",
  "evidence_source",
  "source_artifact",
  "ingested_data_item",
  "curation_candidate",
  "curation_review_decision",
  "sample_code_snippet",
] as const;

export type AttackKbStorageObjectType = (typeof ATTACK_KB_STORAGE_OBJECT_TYPES)[number];

export const ATTACK_KB_SOURCE_CATEGORIES = [
  "owasp",
  "mitre_atlas",
  "nist_ai_rmf_genai",
  "maestro_agentic_risk",
  "research_paper",
  "vendor_documentation",
  "manual_observation",
] as const;

export type AttackKbSourceCategory = (typeof ATTACK_KB_SOURCE_CATEGORIES)[number];

export type EvidenceSourceType = "standard" | "paper" | "documentation" | "manual_seed" | "run_outcome";

export type SourceProvenance = {
  category: AttackKbSourceCategory;
  originLabel: string;
  publisher?: string;
  url?: string;
  retrievedAt: string;
  retrievedBy: "manual" | "source_discovery_agent" | "source_retrieval_agent" | "import_script";
  sourceVersion?: string;
  standardsRefs: string[];
  license?: string;
};

export type SourceEvidence = {
  summary: string;
  excerpt?: string;
  locator?: string;
  confidence: number;
  observedAt: string;
};

export type SourceArtifact = {
  id: string;
  title: string;
  sourceType: EvidenceSourceType;
  category: AttackKbSourceCategory;
  url?: string;
  description: string;
  provenance: SourceProvenance;
  evidence: SourceEvidence[];
};

export type IngestedDataItem = {
  id: string;
  title: string;
  dataType: "standard_excerpt" | "agentic_risk_note" | "run_observation" | "manual_note";
  sourceRef?: string;
  content: string;
  provenance: SourceProvenance;
  evidence: SourceEvidence[];
};

export type CurationCandidate = {
  id: string;
  candidateType: "source_artifact" | "ingested_data_item";
  objectRef: {
    id: string;
    storageType: Extract<AttackKbStorageObjectType, "source_artifact" | "ingested_data_item">;
  };
  sourceCategory: AttackKbSourceCategory;
  status: "queued" | "review_required" | "accepted" | "rejected" | "merged";
  reason: string;
  suggestedObjectTypes: AttackKbStorageObjectType[];
  evidence: SourceEvidence[];
  createdAt: string;
  triggeredBy: "source_ingestion" | "data_item_ingestion";
  curationFlow: {
    flow: "manual_review_queue";
    firedAt: string;
    status: "fired";
    notes: string[];
  };
};

export type CurationReviewDecisionAction = "accept" | "reject" | "edit" | "merge";

export type CurationReviewDecision = {
  id: string;
  candidateRef: {
    id: string;
    storageType: Extract<AttackKbStorageObjectType, "curation_candidate">;
  };
  mode: "proposal" | "decision";
  reviewer: {
    kind: "human" | "agent" | "auto";
    id: string;
  };
  action: CurationReviewDecisionAction;
  score?: number;
  rationale: string;
  mergeTargetRef?: {
    id: string;
    storageType: AttackKbStorageObjectType;
  };
  editedObjects?: AttackKbCanonicalObject[];
  persistedObjectRefs?: {
    id: string;
    storageType: AttackKbStorageObjectType;
  }[];
  createdAt: string;
  weaveTrace: "enabled" | "disabled_missing_wandb_api_key" | "disabled_by_caller";
};

export type Vulnerability = {
  id: string;
  domain?: AttackKbDomain;
  title: string;
  description: string;
  category: "prompt_injection" | "tool_misuse" | "rag_memory" | "policy_bypass" | "business_logic";
  severity?: "low" | "medium" | "high" | "critical";
  safetyBoundary: string;
};

export type AttackPattern = {
  id: string;
  domain?: AttackKbDomain;
  phase: AttackPhase;
  title: string;
  description: string;
  vulnerabilityRefs: string[];
  safetyBoundary: string;
};

export type PayloadTemplate = {
  id: string;
  title: string;
  description: string;
  template: string;
  safetyBoundary: string;
};

export type DeliveryMode = {
  id: string;
  title: string;
  description: string;
  channel: "chat" | "tool_output" | "rag_document" | "memory" | "api";
  safetyBoundary: string;
};

export type SuccessSignal = {
  id: string;
  title: string;
  description: string;
  observable: string;
  safetyBoundary: string;
};

export type EvidenceSource = {
  id: string;
  title: string;
  sourceType: EvidenceSourceType;
  url?: string;
  description: string;
  retrievedAt?: string;
  provenance?: SourceProvenance;
  evidence?: SourceEvidence[];
};

export type SampleCodeSnippet = {
  id: string;
  title: string;
  language: string;
  code: string;
  safetyBoundary: string;
};

export type AttackKbStoragePayloadByType = {
  domain_decision_factor: DomainDecisionFactor;
  recon_probe: ReconProbe;
  domain_scenario: DomainScenario;
  business_attack_route: BusinessAttackRoute;
  system_attack_pattern: SystemAttackPattern;
  vulnerability: Vulnerability;
  attack_pattern: AttackPattern;
  payload_template: PayloadTemplate;
  delivery_mode: DeliveryMode;
  success_signal: SuccessSignal;
  evidence_source: EvidenceSource;
  source_artifact: SourceArtifact;
  ingested_data_item: IngestedDataItem;
  curation_candidate: CurationCandidate;
  curation_review_decision: CurationReviewDecision;
  sample_code_snippet: SampleCodeSnippet;
};

export type AttackKbCanonicalObject<TObjectType extends AttackKbStorageObjectType = AttackKbStorageObjectType> = {
  id: string;
  objectType: TObjectType;
  domain?: AttackKbDomain;
  title: string;
  description?: string;
  version: number;
  updatedAt: string;
  sourceRefs: string[];
  tags: string[];
  payload: AttackKbStoragePayloadByType[TObjectType];
};

export type AttackKbRef = {
  id: string;
  type:
    | "DomainDecisionFactor"
    | "ReconProbe"
    | "DomainScenario"
    | "BusinessAttackRoute"
    | "SystemAttackPattern";
  storageType: Extract<
    AttackKbStorageObjectType,
    | "domain_decision_factor"
    | "recon_probe"
    | "domain_scenario"
    | "business_attack_route"
    | "system_attack_pattern"
  >;
};

export type AttackKbResponse = {
  requestId: string;
  generatedAt: string;
  domain: AttackKbDomain;
  phase: AttackPhase;
  systemBoundary: string;
  missingInfo: MissingInfo[];
  recommendations: AttackRecommendation[];
  kbRefs: AttackKbRef[];
};
