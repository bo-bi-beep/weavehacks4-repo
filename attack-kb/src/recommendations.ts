import { randomUUID } from "node:crypto";

import { creditLoanDecisionFactors, creditLoanReconProbes } from "./credit-loan/seeds.js";
import type {
  AgentUnderTestProfile,
  AttackKbRef,
  AttackKbResponse,
  AttackRecommendation,
  MissingInfo,
} from "./types.js";

const SYSTEM_BOUNDARY =
  "Attack KB is advisory only. It never contacts Agent Under Test and never executes attacks; the main agent owns probing, orchestration, and delivery subagents.";

function hasKnownTargetInfo(profile: AgentUnderTestProfile): boolean {
  return Boolean(
    profile.techStack?.length ||
      profile.modelStack?.length ||
      profile.tools?.length ||
      profile.memoryOrRag?.length ||
      profile.permissions?.length ||
      profile.policies?.length ||
      profile.observedBehavior?.length ||
      profile.observedDecisionFactors?.length,
  );
}

function buildMissingInfo(): MissingInfo[] {
  return creditLoanDecisionFactors.map((factor) => ({
    key: factor.name,
    reason: `${factor.label} is a likely credit-loan decision factor, but the target's actual use of it has not been observed yet.`,
    probeRefs: creditLoanReconProbes.filter((probe) => probe.factorRefs.includes(factor.id)).map((probe) => probe.id),
  }));
}

function buildProbingRecommendations(): AttackRecommendation[] {
  return creditLoanReconProbes.map((probe) => ({
    id: `rec-${probe.id}`,
    phase: "probing",
    title: probe.title,
    whyRelevant:
      "The main agent has insufficient Agent Under Test information. First infer which likely credit-loan decision factors the target actually uses before requesting attack-route recommendations.",
    domainDecisionFactorRefs: probe.factorRefs,
    reconProbeRefs: [probe.id],
    expectedFindings: probe.expectedFindings,
    safetyBoundary: probe.safetyBoundary,
  }));
}

function buildKbRefs(): AttackKbRef[] {
  return [
    ...creditLoanDecisionFactors.map((factor): AttackKbRef => ({
      id: factor.id,
      type: "DomainDecisionFactor",
    })),
    ...creditLoanReconProbes.map((probe): AttackKbRef => ({
      id: probe.id,
      type: "ReconProbe",
    })),
  ];
}

export function getAttackKbRecommendations(
  profile: AgentUnderTestProfile = {},
  options: { requestId?: string; generatedAt?: Date } = {},
): AttackKbResponse {
  const domain = profile.domain ?? "credit_loan";

  if (domain !== "credit_loan") {
    throw new Error(`Unsupported Attack KB domain for P0: ${domain}`);
  }

  const generatedAt = options.generatedAt ?? new Date();
  const requestId = options.requestId ?? randomUUID();
  const knownTargetInfo = hasKnownTargetInfo(profile);

  if (!knownTargetInfo) {
    return {
      requestId,
      generatedAt: generatedAt.toISOString(),
      domain,
      phase: "probing",
      systemBoundary: SYSTEM_BOUNDARY,
      missingInfo: buildMissingInfo(),
      recommendations: buildProbingRecommendations(),
      kbRefs: buildKbRefs(),
    };
  }

  return {
    requestId,
    generatedAt: generatedAt.toISOString(),
    domain,
    phase: "probing",
    systemBoundary: SYSTEM_BOUNDARY,
    missingInfo: buildMissingInfo().filter(
      (missing) => !profile.observedDecisionFactors?.some((observed) => observed.factorRef === `factor-${missing.key.replaceAll("_", "-")}`),
    ),
    recommendations: buildProbingRecommendations(),
    kbRefs: buildKbRefs(),
  };
}
