import {
  creditLoanBusinessAttackRoutes,
  creditLoanDecisionFactors,
  creditLoanDomainScenarios,
  creditLoanReconProbes,
  creditLoanSystemAttackPatterns,
} from "../credit-loan/seeds.js";
import type { AttackKbCanonicalObject } from "../types.js";

const SEED_UPDATED_AT = "2026-01-01T00:00:00.000Z";

export function buildSeedAttackKbObjects(): AttackKbCanonicalObject[] {
  return [
    ...creditLoanDecisionFactors.map(
      (factor): AttackKbCanonicalObject<"domain_decision_factor"> => ({
        id: factor.id,
        objectType: "domain_decision_factor",
        domain: factor.domain,
        title: factor.label,
        description: factor.description,
        version: 1,
        updatedAt: SEED_UPDATED_AT,
        sourceRefs: [],
        tags: ["seed", "credit-loan", "decision-factor"],
        payload: factor,
      }),
    ),
    ...creditLoanReconProbes.map(
      (probe): AttackKbCanonicalObject<"recon_probe"> => ({
        id: probe.id,
        objectType: "recon_probe",
        domain: probe.domain,
        title: probe.title,
        description: probe.description,
        version: 1,
        updatedAt: SEED_UPDATED_AT,
        sourceRefs: [],
        tags: ["seed", "credit-loan", "recon-probe"],
        payload: probe,
      }),
    ),
    ...creditLoanDomainScenarios.map(
      (scenario): AttackKbCanonicalObject<"domain_scenario"> => ({
        id: scenario.id,
        objectType: "domain_scenario",
        domain: scenario.domain,
        title: scenario.title,
        description: scenario.description,
        version: 1,
        updatedAt: SEED_UPDATED_AT,
        sourceRefs: [],
        tags: ["seed", "credit-loan", "domain-scenario"],
        payload: scenario,
      }),
    ),
    ...creditLoanBusinessAttackRoutes.map(
      (route): AttackKbCanonicalObject<"business_attack_route"> => ({
        id: route.id,
        objectType: "business_attack_route",
        domain: route.domain,
        title: route.title,
        description: route.description,
        version: 1,
        updatedAt: SEED_UPDATED_AT,
        sourceRefs: [],
        tags: ["seed", "credit-loan", "business-route"],
        payload: route,
      }),
    ),
    ...creditLoanSystemAttackPatterns.map(
      (pattern): AttackKbCanonicalObject<"system_attack_pattern"> => ({
        id: pattern.id,
        objectType: "system_attack_pattern",
        domain: "credit_loan",
        title: pattern.title,
        description: pattern.description,
        version: 1,
        updatedAt: SEED_UPDATED_AT,
        sourceRefs: [],
        tags: ["seed", "credit-loan", "system-pattern"],
        payload: pattern,
      }),
    ),
  ];
}
