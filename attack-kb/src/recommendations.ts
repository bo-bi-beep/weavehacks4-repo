import { randomUUID } from "node:crypto";

import { recordMemory } from "./memory/index.js";
import { recordAttackKbEvent } from "./redis/streams.js";
import { getDefaultAttackKbStorageAdapter, type AttackKbStorageAdapter } from "./storage/index.js";
import type {
  AgentUnderTestProfile,
  AttackKbCanonicalObject,
  AttackKbMemoryAdapter,
  AttackKbRef,
  AttackKbResponse,
  AttackRecommendation,
  BusinessAttackRoute,
  DomainDecisionFactor,
  DomainScenario,
  MissingInfo,
  ObservedDecisionFactor,
  ReconProbe,
  SystemAttackPattern,
} from "./types.js";

const SYSTEM_BOUNDARY =
  "Attack KB is advisory only. It never contacts Agent Under Test and never executes attacks; the main agent owns probing, orchestration, and delivery subagents. All recommendations are for synthetic defensive testing only.";

export type AttackKbRecommendationOptions = {
  requestId?: string;
  generatedAt?: Date;
  storage?: AttackKbStorageAdapter;
  memory?: AttackKbMemoryAdapter | false;
};

type CreditLoanKnowledge = {
  decisionFactors: DomainDecisionFactor[];
  reconProbes: ReconProbe[];
  domainScenarios: DomainScenario[];
  businessRoutes: BusinessAttackRoute[];
  systemPatterns: SystemAttackPattern[];
};

function observedFactorRefs(profile: AgentUnderTestProfile): Set<string> {
  return new Set(profile.observedDecisionFactors?.map((observed) => observed.factorRef) ?? []);
}

function hasObservedDecisionFactors(profile: AgentUnderTestProfile): boolean {
  return observedFactorRefs(profile).size > 0;
}

function isCanonicalObjectType<TObjectType extends AttackKbCanonicalObject["objectType"]>(
  object: AttackKbCanonicalObject,
  objectType: TObjectType,
): object is AttackKbCanonicalObject<TObjectType> {
  return object.objectType === objectType;
}

async function payloadsFor<TObjectType extends AttackKbCanonicalObject["objectType"]>(
  storage: AttackKbStorageAdapter,
  objectType: TObjectType,
): Promise<AttackKbCanonicalObject<TObjectType>["payload"][]> {
  const objects = await storage.list({ objectType, domain: "credit_loan" });
  return objects.filter((object) => isCanonicalObjectType(object, objectType)).map((object) => object.payload);
}

async function loadCreditLoanKnowledge(storage: AttackKbStorageAdapter): Promise<CreditLoanKnowledge> {
  const [decisionFactors, reconProbes, domainScenarios, businessRoutes, systemPatterns] = await Promise.all([
    payloadsFor(storage, "domain_decision_factor"),
    payloadsFor(storage, "recon_probe"),
    payloadsFor(storage, "domain_scenario"),
    payloadsFor(storage, "business_attack_route"),
    payloadsFor(storage, "system_attack_pattern"),
  ]);

  return {
    decisionFactors,
    reconProbes,
    domainScenarios,
    businessRoutes,
    systemPatterns,
  };
}

function buildMissingInfo(profile: AgentUnderTestProfile, knowledge: CreditLoanKnowledge): MissingInfo[] {
  const observed = observedFactorRefs(profile);

  return knowledge.decisionFactors
    .filter((factor) => !observed.has(factor.id))
    .map((factor) => ({
      key: factor.name,
      reason: `${factor.label} is a likely credit-loan decision factor, but the target's actual use of it has not been observed yet.`,
      probeRefs: knowledge.reconProbes
        .filter((probe) => probe.factorRefs.includes(factor.id))
        .map((probe) => probe.id),
    }));
}

function buildProbingRecommendations(knowledge: CreditLoanKnowledge): AttackRecommendation[] {
  return knowledge.reconProbes.map((probe) => ({
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

function matchingRoutes(profile: AgentUnderTestProfile, knowledge: CreditLoanKnowledge): BusinessAttackRoute[] {
  const observed = observedFactorRefs(profile);

  const routes = knowledge.businessRoutes.filter((route) =>
    route.decisionFactorRefs.some((factorRef) => observed.has(factorRef)),
  );

  return routes.sort((left, right) => {
    const rightMatches = right.decisionFactorRefs.filter((factorRef) => observed.has(factorRef)).length;
    const leftMatches = left.decisionFactorRefs.filter((factorRef) => observed.has(factorRef)).length;

    return rightMatches - leftMatches || left.id.localeCompare(right.id);
  });
}

function expectedFindingsForRoute(route: BusinessAttackRoute, knowledge: CreditLoanKnowledge): string[] {
  const scenarios = knowledge.domainScenarios.filter((scenario) => route.scenarioRefs.includes(scenario.id));
  const patterns = knowledge.systemPatterns.filter((pattern) => route.systemPatternRefs.includes(pattern.id));

  return [
    route.defensiveObjective,
    ...scenarios.map((scenario) => scenario.expectedSafeObservation),
    ...patterns.map((pattern) => pattern.defensiveObjective),
  ];
}

function buildAttackRecommendations(
  profile: AgentUnderTestProfile,
  knowledge: CreditLoanKnowledge,
): AttackRecommendation[] {
  const observed = observedFactorRefs(profile);
  const observedFactors = profile.observedDecisionFactors ?? [];

  return matchingRoutes(profile, knowledge).map((route) => {
    const matchedFactorRefs = route.decisionFactorRefs.filter((factorRef) => observed.has(factorRef));
    const scenarioRefs = route.scenarioRefs.filter((scenarioRef) =>
      knowledge.domainScenarios.some(
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
      expectedFindings: expectedFindingsForRoute(route, knowledge),
      safetyBoundary: `${route.safetyBoundary} Do not turn this into instructions for obtaining credit, concealing debt, fabricating income, bypassing verification, or evading fraud controls.`,
    } satisfies AttackRecommendation;
  });
}

function buildKbRefs(knowledge: CreditLoanKnowledge): AttackKbRef[] {
  return [
    ...knowledge.decisionFactors.map((factor): AttackKbRef => ({
      id: factor.id,
      type: "DomainDecisionFactor",
      storageType: "domain_decision_factor",
    })),
    ...knowledge.reconProbes.map((probe): AttackKbRef => ({
      id: probe.id,
      type: "ReconProbe",
      storageType: "recon_probe",
    })),
    ...knowledge.domainScenarios.map((scenario): AttackKbRef => ({
      id: scenario.id,
      type: "DomainScenario",
      storageType: "domain_scenario",
    })),
    ...knowledge.businessRoutes.map((route): AttackKbRef => ({
      id: route.id,
      type: "BusinessAttackRoute",
      storageType: "business_attack_route",
    })),
    ...knowledge.systemPatterns.map((pattern): AttackKbRef => ({
      id: pattern.id,
      type: "SystemAttackPattern",
      storageType: "system_attack_pattern",
    })),
  ];
}

let warnedAboutRecommendationMemory = false;

function warnRecommendationMemorySkipped(error: unknown): void {
  if (warnedAboutRecommendationMemory) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.emitWarning(`Attack KB recommendation memory recording skipped. ${message}`, {
    code: "ATTACK_KB_MEMORY_RECORD_SKIPPED",
  });
  warnedAboutRecommendationMemory = true;
}

async function recordRecommendationRunMemory(
  profile: AgentUnderTestProfile,
  response: AttackKbResponse,
  options: AttackKbRecommendationOptions,
): Promise<void> {
  if (options.memory === false) {
    return;
  }

  try {
    await recordMemory(
      "attack-kb-runs",
      {
        runId: response.requestId,
        summary: `Attack KB generated ${response.phase} recommendations for ${response.domain}.`,
        text: [
          `phase=${response.phase}`,
          `recommendations=${response.recommendations.map((recommendation) => recommendation.id).join(",")}`,
          `missingInfo=${response.missingInfo.map((info) => info.key).join(",")}`,
        ].join("\n"),
        tags: ["recommendation-run", response.domain, response.phase],
        source: "attack_kb",
        safetyBoundary: response.systemBoundary,
        payload: {
          requestId: response.requestId,
          domain: response.domain,
          phase: response.phase,
          profileSnapshot: profile,
          recommendationIds: response.recommendations.map((recommendation) => recommendation.id),
          missingInfoKeys: response.missingInfo.map((info) => info.key),
          kbRefIds: response.kbRefs.map((ref) => ref.id),
          directAutContactByAttackKb: false,
          safeSyntheticOnly: true,
        },
      },
      options.memory ? { adapter: options.memory } : undefined,
    );
  } catch (error) {
    warnRecommendationMemorySkipped(error);
  }
}

export async function getAttackKbRecommendations(
  profile: AgentUnderTestProfile = {},
  options: AttackKbRecommendationOptions = {},
): Promise<AttackKbResponse> {
  const domain = profile.domain ?? "credit_loan";

  if (domain !== "credit_loan") {
    throw new Error(`Unsupported Attack KB domain for P0: ${domain}`);
  }

  const storage = options.storage ?? getDefaultAttackKbStorageAdapter();
  const knowledge = await loadCreditLoanKnowledge(storage);
  const generatedAt = options.generatedAt ?? new Date();
  const requestId = options.requestId ?? randomUUID();

  const response: AttackKbResponse = !hasObservedDecisionFactors(profile)
    ? {
        requestId,
        generatedAt: generatedAt.toISOString(),
        domain,
        phase: "probing",
        systemBoundary: SYSTEM_BOUNDARY,
        missingInfo: buildMissingInfo(profile, knowledge),
        recommendations: buildProbingRecommendations(knowledge),
        kbRefs: buildKbRefs(knowledge),
      }
    : {
        requestId,
        generatedAt: generatedAt.toISOString(),
        domain,
        phase: "attack",
        systemBoundary: SYSTEM_BOUNDARY,
        missingInfo: buildMissingInfo(profile, knowledge),
        recommendations: buildAttackRecommendations(profile, knowledge),
        kbRefs: buildKbRefs(knowledge),
      };

  await recordAttackKbEvent({
    type: "recommendation_requested",
    source: "attack-kb.recommendations",
    timestamp: response.generatedAt,
    payload: {
      requestId: response.requestId,
      domain: response.domain,
      phase: response.phase,
      missingInfoCount: response.missingInfo.length,
      recommendationCount: response.recommendations.length,
      observedDecisionFactorCount: profile.observedDecisionFactors?.length ?? 0,
      kbRefCount: response.kbRefs.length,
      storage: {
        adapter: storage.name,
        backend: storage.backend,
      },
    },
  });
  await recordRecommendationRunMemory(profile, response, options);
  return response;
}
