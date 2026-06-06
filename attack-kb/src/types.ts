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

export type MissingInfo = {
  key: string;
  reason: string;
  probeRefs: string[];
};

export type AttackRecommendation = {
  id: string;
  phase: AttackPhase;
  title: string;
  whyRelevant: string;
  domainDecisionFactorRefs: string[];
  reconProbeRefs?: string[];
  expectedFindings?: string[];
  safetyBoundary: string;
};

export type AttackKbRef = {
  id: string;
  type: "DomainDecisionFactor" | "ReconProbe";
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
