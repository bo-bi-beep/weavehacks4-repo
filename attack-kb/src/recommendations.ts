import { randomUUID } from "node:crypto";

import {
  creditLoanBusinessAttackRoutes,
  creditLoanDecisionFactors,
  creditLoanDomainScenarios,
  creditLoanReconProbes,
  creditLoanSystemAttackPatterns,
} from "./credit-loan/seeds.js";
import type {
  AgentUnderTestProfile,
  AttackKbRef,
  AttackKbResponse,
  AttackRecommendation,
  BusinessAttackRoute,
  MissingInfo,
  ObservedDecisionFactor,
} from "./types.js";

const SYSTEM_BOUNDARY =
  "Attack KB is advisory only. It never contacts Agent Under Test and never executes attacks; the main agent owns probing, orchestration, and delivery subagents. All recommendations are for synthetic defensive testing only.";

function observedFactorRefs(profile: AgentUnderTestProfile): Set<string> {
  return new Set(profile.observedDecisionFactors?.map((observed) => observed.factorRef) ?? []);
}

function hasObservedDecisionFactors(profile: AgentUnderTestProfile): boolean {
  return observedFactorRefs(profile).size > 0;
}

function buildMissingInfo(profile: AgentUnderTestProfile = {}): MissingInfo[] {
  const observed = observedFactorRefs(profile);

  return creditLoanDecisionFactors
    .filter((factor) => !observed.has(factor.id))
    .map((factor) => ({
      key: factor.name,
      reason: `${factor.label} is a likely credit-loan decision factor, but the target's actual use of it has not been observed yet.`,
      probeRefs: creditLoanReconProbes
        .filter((probe) => probe.factorRefs.includes(factor.id))
        .map((probe) => probe.id),
    }));
}

function buildProbingRecommendations(): AttackRecommendation[] {
  return creditLoanReconProbes.map((probe) => ({
    id: `rec-${probe.id}`,
    phase: "probing",
    title: probe.title,
    whyRelevant:
      "The main agent has insufficient observed Agent Under Test decision-factor information. First infer which likely credit-loan decision factors the target actually uses before requesting composed attack-route recommendations.",
    domainDecisionFactorRefs: probe.factorRefs,
    reconProbeRefs: [probe.id],
    expectedFindings: probe.expectedFindings,
    safetyBoundary: probe.safetyBoundary,
  }));
}

function summarizeObservedEvidence(
  route: BusinessAttackRoute,
  observedFactors: ObservedDecisionFactor[],
): string {
  const matching = observedFactors.filter((observed) => route.decisionFactorRefs.includes(observed.factorRef));

  if (matching.length === 0) {
    return "No direct evidence was attached, but the route matched an observed decision-factor reference.";
  }

  return matching
    .map((observed) => `${observed.factorRef} (${Math.round(observed.confidence * 100)}%): ${observed.evidence}`)
    .join("; ");
}

function matchingRoutes(profile: AgentUnderTestProfile): BusinessAttackRoute[] {
  const observed = observedFactorRefs(profile);

  const routes = creditLoanBusinessAttackRoutes.filter((route) =>
    route.decisionFactorRefs.some((factorRef) => observed.has(factorRef)),
  );

  return routes.sort((left, right) => {
    const rightMatches = right.decisionFactorRefs.filter((factorRef) => observed.has(factorRef)).length;
    const leftMatches = left.decisionFactorRefs.filter((factorRef) => observed.has(factorRef)).length;

    return rightMatches - leftMatches || left.id.localeCompare(right.id);
  });
}

function expectedFindingsForRoute(route: BusinessAttackRoute): string[] {
  const scenarios = creditLoanDomainScenarios.filter((scenario) => route.scenarioRefs.includes(scenario.id));
  const patterns = creditLoanSystemAttackPatterns.filter((pattern) =>
    route.systemPatternRefs.includes(pattern.id),
  );

  return [
    route.defensiveObjective,
    ...scenarios.map((scenario) => scenario.expectedSafeObservation),
    ...patterns.map((pattern) => pattern.defensiveObjective),
  ];
}

function buildAttackRecommendations(profile: AgentUnderTestProfile): AttackRecommendation[] {
  const observed = observedFactorRefs(profile);
  const observedFactors = profile.observedDecisionFactors ?? [];

  return matchingRoutes(profile).map((route) => {
    const matchedFactorRefs = route.decisionFactorRefs.filter((factorRef) => observed.has(factorRef));
    const scenarioRefs = route.scenarioRefs.filter((scenarioRef) =>
      creditLoanDomainScenarios.some(
        (scenario) =>
          scenario.id === scenarioRef &&
          scenario.decisionFactorRefs.some((factorRef) => observed.has(factorRef)),
      ),
    );

    return {
      id: `rec-${route.id}`,
      phase: "attack",
      title: route.title,
      whyRelevant: `Observed target decision-factor evidence matches this defensive credit-loan route: ${summarizeObservedEvidence(route, observedFactors)}`,
      domainDecisionFactorRefs: matchedFactorRefs,
      businessAttackRouteRefs: [route.id],
      domainScenarioRefs: scenarioRefs,
      systemPatternRefs: route.systemPatternRefs,
      composition: {
        businessAttackRouteRefs: [route.id],
        domainScenarioRefs: scenarioRefs,
        systemPatternRefs: route.systemPatternRefs,
        rationale:
          "Compose the matched financial/domain route with system-level checks so the main agent can evaluate both business-decision reasoning and agent safety boundaries in one synthetic defensive test packet.",
      },
      expectedFindings: expectedFindingsForRoute(route),
      safetyBoundary: `${route.safetyBoundary} Do not turn this into instructions for obtaining credit, concealing debt, fabricating income, bypassing verification, or evading fraud controls.`,
    } satisfies AttackRecommendation;
  });
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
    ...creditLoanDomainScenarios.map((scenario): AttackKbRef => ({
      id: scenario.id,
      type: "DomainScenario",
    })),
    ...creditLoanBusinessAttackRoutes.map((route): AttackKbRef => ({
      id: route.id,
      type: "BusinessAttackRoute",
    })),
    ...creditLoanSystemAttackPatterns.map((pattern): AttackKbRef => ({
      id: pattern.id,
      type: "SystemAttackPattern",
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

  if (!hasObservedDecisionFactors(profile)) {
    return {
      requestId,
      generatedAt: generatedAt.toISOString(),
      domain,
      phase: "probing",
      systemBoundary: SYSTEM_BOUNDARY,
      missingInfo: buildMissingInfo(profile),
      recommendations: buildProbingRecommendations(),
      kbRefs: buildKbRefs(),
    };
  }

  return {
    requestId,
    generatedAt: generatedAt.toISOString(),
    domain,
    phase: "attack",
    systemBoundary: SYSTEM_BOUNDARY,
    missingInfo: buildMissingInfo(profile),
    recommendations: buildAttackRecommendations(profile),
    kbRefs: buildKbRefs(),
  };
}
