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

export type AttackRecommendationDerivedArtifactRef = {
  id: string;
  storageType: AttackKbStorageObjectType;
  title: string;
  sourceRefs?: string[];
};

export type AttackRecommendationSampleTurn = {
  speaker: "attacker_agent" | "agent_under_test" | "tool" | "evaluator";
  content: string;
  purpose?: string;
};

export type AttackRecommendationSampleScenario = {
  id: string;
  title: string;
  deliveryModeRef?: string;
  attackerObjective: string;
  targetOutcome: string;
  syntheticSetup: string;
  turns: AttackRecommendationSampleTurn[];
  breachSuccessIndicators: string[];
  resistanceSignals: string[];
  observationChecklist: string[];
};

export type AttackRecommendation = {
  attackerGoal?: string;
  targetOutcome?: string;
  attackNarrative?: string;
  attackerSteps?: string[];
  breachSuccessCriteria?: string[];
  resistanceSignals?: string[];
  evidenceToCapture?: string[];
  id: string;
  phase: AttackPhase;
  title: string;
  whyRelevant: string;
  domainDecisionFactorRefs: string[];
  reconProbeRefs?: string[];
  businessAttackRouteRefs?: string[];
  domainScenarioRefs?: string[];
  systemPatternRefs?: string[];
  vulnerabilityRefs?: string[];
  attackPatternRefs?: string[];
  deliveryModeRefs?: string[];
  successSignalRefs?: string[];
  payloadTemplateRefs?: string[];
  evidenceSourceRefs?: string[];
  derivedArtifactRefs?: AttackRecommendationDerivedArtifactRef[];
  sampleScenarios?: AttackRecommendationSampleScenario[];
  composition?: RecommendationComposition;
  expectedFindings?: string[];
  safetyBoundary: string;
};

export const ATTACK_KB_MEMORY_NAMESPACES = [
  "attack-kb-runs",
  "target-observations",
  "curation",
  "recommendation-outcomes",
  "subagent-reports",
] as const;

export type AttackKbMemoryNamespace = (typeof ATTACK_KB_MEMORY_NAMESPACES)[number];

export type AttackKbMemorySource =
  | "attack_kb"
  | "main_agent"
  | "delivery_subagent"
  | "curation"
  | "human"
  | "demo"
  | "manual";

export type AttackKbRunMemory = {
  requestId: string;
  domain: AttackKbDomain;
  phase: AttackPhase;
  profileSnapshot: AgentUnderTestProfile;
  recommendationIds: string[];
  missingInfoKeys: string[];
  kbRefIds: string[];
  retrievedContextRefIds?: string[];
  directAutContactByAttackKb: false;
  safeSyntheticOnly: true;
};

export type AttackKbTargetObservationMemory = {
  observationId: string;
  observedBy: Extract<AttackKbMemorySource, "main_agent" | "delivery_subagent" | "human" | "demo">;
  domain: AttackKbDomain;
  observedBehavior: ObservedBehavior[];
  observedDecisionFactors: ObservedDecisionFactor[];
  profilePatch?: AgentUnderTestProfile;
  evidenceSummary: string;
  recommendationIds?: string[];
  directAutContactByAttackKb: false;
  safeSyntheticOnly: true;
};

export type AttackKbCurationMemory = {
  curationEventId: string;
  candidateId?: string;
  decisionId?: string;
  status: "queued" | "review_required" | "accepted" | "rejected" | "merged" | "proposal_recorded";
  summary: string;
  objectRefs: { id: string; storageType?: string }[];
  directAutContactByAttackKb: false;
  safeSyntheticOnly: true;
};

export type AttackKbRecommendationOutcomeMemory = {
  outcomeId: string;
  requestId?: string;
  recommendationId: string;
  outcome: "observed" | "not_observed" | "partially_observed" | "blocked" | "unsafe_skipped";
  reportedBy: Extract<AttackKbMemorySource, "main_agent" | "delivery_subagent" | "human" | "demo">;
  observationSummary: string;
  evidence?: string;
  confidence?: number;
  nextStep?: "continue" | "reprobe" | "curation" | "stop";
  directAutContactByAttackKb: false;
  safeSyntheticOnly: true;
};

export type AttackKbSubagentReportMemory = {
  reportId: string;
  subagentId: string;
  recommendationId?: string;
  assignedPhase: AttackPhase | "delivery";
  status: "assigned" | "completed" | "blocked" | "unsafe_skipped";
  observationSummary: string;
  evidence?: string;
  confidence?: number;
  directAutContactByAttackKb: false;
  safeSyntheticOnly: true;
};

export type AttackKbMemoryPayloadByNamespace = {
  "attack-kb-runs": AttackKbRunMemory;
  "target-observations": AttackKbTargetObservationMemory;
  curation: AttackKbCurationMemory;
  "recommendation-outcomes": AttackKbRecommendationOutcomeMemory;
  "subagent-reports": AttackKbSubagentReportMemory;
};

export type AttackKbMemoryRecord<TNamespace extends AttackKbMemoryNamespace = AttackKbMemoryNamespace> = {
  id: string;
  namespace: TNamespace;
  runId?: string;
  recommendationId?: string;
  summary: string;
  text: string;
  tags: string[];
  createdAt: string;
  source: AttackKbMemorySource;
  safetyBoundary: string;
  payload: AttackKbMemoryPayloadByNamespace[TNamespace];
};

export type AttackKbMemoryRecordInput<TNamespace extends AttackKbMemoryNamespace> = {
  id?: string;
  runId?: string;
  recommendationId?: string;
  summary: string;
  text?: string;
  tags?: string[];
  createdAt?: string | Date;
  source: AttackKbMemorySource;
  safetyBoundary?: string;
  payload: AttackKbMemoryPayloadByNamespace[TNamespace];
};

export type AttackKbMemorySearchQuery = {
  namespace?: AttackKbMemoryNamespace;
  text?: string;
  tags?: string[];
  runId?: string;
  recommendationId?: string;
  limit?: number;
};

export type AttackKbMemoryBackend = "local-memory" | "redis";

export type AttackKbMemoryAdapter = {
  name: string;
  backend: AttackKbMemoryBackend;
  recordMemory<TNamespace extends AttackKbMemoryNamespace>(
    namespace: TNamespace,
    input: AttackKbMemoryRecordInput<TNamespace>,
  ): Promise<AttackKbMemoryRecord<TNamespace>>;
  searchMemory(query: AttackKbMemorySearchQuery): Promise<AttackKbMemoryRecord[]>;
  listRecent(namespace?: AttackKbMemoryNamespace, limit?: number): Promise<AttackKbMemoryRecord[]>;
  close?(): Promise<void>;
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
  attackerGoalCategory?: string;
  attackerGoal?: string;
  targetOutcome?: string;
  channel?: DeliveryMode["channel"];
  requiredSlots?: string;
  turnPattern?: string;
  breachSuccessIndicators?: string;
  evidenceToCapture?: string;
  attackPatternIds?: string[];
  vulnerabilityIds?: string[];
  deliveryModeId?: string;
  successSignalIds?: string[];
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

export type AttackKbRetrievedContextRef = {
  id: string;
  storageType: AttackKbStorageObjectType;
  title: string;
  score: number;
  backend: "local" | "redis";
  chunkId: string;
  textPreview: string;
};

export type AttackKbRetrievedContext = {
  usedFor: "main_agent_recommendation";
  p1SubagentContextRetrieval: false;
  query: string;
  backend: "local" | "redis";
  generatedAt: string;
  resultCount: number;
  indexName?: string;
  keyPrefix?: string;
  refs: AttackKbRetrievedContextRef[];
};

export type AttackKbArtifactSelectionRef = {
  id: string;
  storageType: AttackKbStorageObjectType;
  title: string;
  score?: number;
  selectedFrom: "semantic_retrieval" | "template_companion" | "linked_companion";
  contextRetriever?: {
    toolName?: string;
    status: "hydrated" | "unsupported" | "unconfigured" | "error";
    error?: string;
  };
};

export type AttackKbArtifactSelection = {
  strategy: string;
  primaryObjectTypes: AttackKbStorageObjectType[];
  selectedRefs: AttackKbArtifactSelectionRef[];
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
  retrievedContext?: AttackKbRetrievedContext;
  artifactSelection?: AttackKbArtifactSelection;
  recommendationBuilderCache?: {
    provider: "disabled" | "local" | "redis" | "langcache";
    hit: boolean;
    exact: boolean;
    task: string;
    model: string;
  };
};
