import "dotenv/config";

import { initWeave, weave } from "../../src/lib/weave.js";
import { autoReviewCurationCandidate, recordCurationDecision } from "../src/curation/service.js";
import { ingestAttackKbDataItem, ingestAttackKbSource } from "../src/ingestion/index.js";
import { recordAttackKbEvent } from "../src/redis/streams.js";
import { buildSampleMaestroDataItem, sampleOwaspAgenticSource } from "../src/ingestion/sample.js";
import { getAttackKbRecommendations } from "../src/recommendations.js";
import { closeDefaultAttackKbStorageAdapter } from "../src/storage/index.js";
import type { AgentUnderTestProfile, AttackKbResponse } from "../src/types.js";

type TraceState = "enabled" | "disabled_missing_wandb_api_key";

type EvalScore = {
  name: string;
  passed: boolean;
  score: 0 | 1;
  reason: string;
};

type EvalCaseResult = {
  id: string;
  title: string;
  trace: TraceState;
  scores: EvalScore[];
  summary: Record<string, unknown>;
};

type EvalRunResult = {
  ok: boolean;
  generatedAt: string;
  trace: TraceState;
  cases: EvalCaseResult[];
  totals: {
    passed: number;
    failed: number;
    score: number;
  };
};

function score(name: string, passed: boolean, reason: string): EvalScore {
  return {
    name,
    passed,
    score: passed ? 1 : 0,
    reason,
  };
}

function scoreIncludes(value: string, needle: string, name: string, reason: string): EvalScore {
  return score(name, value.toLowerCase().includes(needle.toLowerCase()), reason);
}

function caseOk(result: EvalCaseResult): boolean {
  return result.scores.every((item) => item.passed);
}

async function initWeaveIfAvailable(): Promise<TraceState> {
  if (!process.env.WANDB_API_KEY?.trim()) {
    return "disabled_missing_wandb_api_key";
  }

  await initWeave();
  return "enabled";
}

async function evaluateEmptyProfileRecommendation(trace: TraceState): Promise<EvalCaseResult> {
  const profile: AgentUnderTestProfile = { domain: "credit_loan" };
  const response = await getAttackKbRecommendations(profile);
  const missingKeys = response.missingInfo.map((item) => item.key).sort();
  const expectedMissing = ["credit_score", "existing_loans", "income", "previous_fraud_history"].sort();

  return {
    id: "empty-profile-probing",
    title: "Empty credit-loan profile returns probing recommendations",
    trace,
    scores: [
      score("phase_is_probing", response.phase === "probing", "Empty/weak profile should stay in probing phase."),
      score(
        "all_recommendations_are_probing",
        response.recommendations.every((recommendation) => recommendation.phase === "probing"),
        "Every recommendation should be probing before target factors are observed.",
      ),
      score(
        "covers_four_credit_loan_factors",
        expectedMissing.every((key) => missingKeys.includes(key)),
        "Missing info should cover credit score, income, existing loans, and previous fraud history.",
      ),
      scoreIncludes(
        response.systemBoundary,
        "never contacts Agent Under Test",
        "system_boundary_blocks_direct_aut_contact",
        "Response boundary should state Attack KB does not contact the Agent Under Test.",
      ),
      score(
        "recommendations_reference_kb_entities",
        response.recommendations.every((recommendation) => recommendation.domainDecisionFactorRefs.length > 0),
        "Probing recommendations should point back to domain decision factors.",
      ),
      score(
        "main_iris_context_retrieved",
        Boolean(response.retrievedContext?.refs.length),
        "Main-agent recommendation path should retrieve Iris/context refs in P0.",
      ),
      score(
        "subagent_context_retrieval_not_used",
        response.retrievedContext?.p1SubagentContextRetrieval === false,
        "Subagent context retrieval/spawn-spec generation remains P1 and should not be used in this main-agent response.",
      ),
    ],
    summary: summarizeResponse(response),
  };
}

const evaluateEmptyProfileRecommendationOp = weave.op(async function evaluateAttackKbEmptyProfileRecommendation(
  trace: TraceState,
): Promise<EvalCaseResult> {
  return evaluateEmptyProfileRecommendation(trace);
});

const richCreditLoanProfile: AgentUnderTestProfile = {
  domain: "credit_loan",
  techStack: ["synthetic demo target"],
  policies: ["fictional credit-loan approval policy observed during defensive evaluation"],
  observedDecisionFactors: [
    {
      factorRef: "factor-credit-score",
      evidence: "Synthetic variants with different credit-score context changed the target's rationale.",
      confidence: 0.86,
    },
    {
      factorRef: "factor-income",
      evidence: "The target requested income and referenced income stability in a fictional approval explanation.",
      confidence: 0.82,
    },
    {
      factorRef: "factor-existing-loans",
      evidence: "The target asked about other outstanding loans before explaining debt-to-income risk.",
      confidence: 0.78,
    },
    {
      factorRef: "factor-previous-fraud-history",
      evidence: "A fictional prior fraud-history signal triggered escalation language in the target response.",
      confidence: 0.74,
    },
  ],
};

async function evaluateRichProfileRecommendation(trace: TraceState): Promise<EvalCaseResult> {
  const response = await getAttackKbRecommendations(richCreditLoanProfile);

  return {
    id: "rich-profile-composed-attack",
    title: "Rich credit-loan profile returns composed attack recommendations",
    trace,
    scores: [
      score("phase_is_attack", response.phase === "attack", "Observed target factors should unlock attack-route recommendations."),
      score(
        "has_composed_recommendations",
        response.recommendations.length > 0 && response.recommendations.every((recommendation) => Boolean(recommendation.composition)),
        "Every rich-profile recommendation should include composition metadata.",
      ),
      score(
        "has_business_and_system_refs",
        response.recommendations.every(
          (recommendation) =>
            (recommendation.businessAttackRouteRefs?.length ?? 0) > 0 &&
            (recommendation.systemPatternRefs?.length ?? 0) > 0,
        ),
        "Recommendations should compose credit-loan business routes with system-level safety patterns.",
      ),
      score(
        "safety_boundaries_are_defensive",
        response.recommendations.every((recommendation) =>
          recommendation.safetyBoundary.toLowerCase().includes("synthetic defensive"),
        ),
        "Recommendations must remain framed as synthetic defensive tests.",
      ),
      score(
        "kb_refs_include_domain_routes",
        response.kbRefs.some((ref) => ref.type === "BusinessAttackRoute") &&
          response.kbRefs.some((ref) => ref.type === "DomainScenario"),
        "Response refs should include domain scenarios and business routes.",
      ),
      score(
        "main_iris_context_retrieved",
        Boolean(response.retrievedContext?.refs.length),
        "Main-agent attack recommendation path should retrieve Iris/context refs in P0.",
      ),
      score(
        "subagent_context_retrieval_not_used",
        response.retrievedContext?.p1SubagentContextRetrieval === false,
        "Subagent context retrieval/spawn-spec generation remains P1 and should not be used in this main-agent response.",
      ),
    ],
    summary: summarizeResponse(response),
  };
}

const evaluateRichProfileRecommendationOp = weave.op(async function evaluateAttackKbRichProfileRecommendation(
  trace: TraceState,
): Promise<EvalCaseResult> {
  return evaluateRichProfileRecommendation(trace);
});

async function evaluateIngestionAndCuration(trace: TraceState): Promise<EvalCaseResult> {
  const sourceResult = await ingestAttackKbSource(sampleOwaspAgenticSource);
  const dataItemResult = await ingestAttackKbDataItem(buildSampleMaestroDataItem(sourceResult.object.id));
  const autoReview = await autoReviewCurationCandidate(sourceResult.curationCandidate.id);
  const humanDecision = await recordCurationDecision(sourceResult.curationCandidate.id, {
    action: "accept",
    reviewerId: "attack-kb-eval",
    rationale: "Eval accepted this standards-backed source after checking provenance, evidence, and proposed objects.",
  });

  return {
    id: "ingestion-curation-provenance",
    title: "Source ingestion triggers curation with provenance, auto-review, and persisted decision",
    trace,
    scores: [
      score(
        "source_has_provenance",
        sourceResult.object.payload.provenance.standardsRefs.length > 0 &&
          Boolean(sourceResult.object.payload.provenance.originLabel),
        "Ingested source should carry provenance and standards refs.",
      ),
      score(
        "source_has_evidence",
        sourceResult.object.payload.evidence.length > 0 && sourceResult.object.payload.evidence[0].confidence > 0,
        "Ingested source should carry evidence with confidence.",
      ),
      score(
        "curation_triggered_for_source_and_data",
        sourceResult.curationFlow.status === "review_required" && dataItemResult.curationFlow.status === "review_required",
        "New source/data additions should fire curation review flow.",
      ),
      score(
        "auto_review_proposes_action",
        ["accept", "reject", "edit", "merge"].includes(autoReview.decision.payload.action),
        "Auto-review should pre-score and propose a review action.",
      ),
      score(
        "human_decision_persists_objects",
        humanDecision.candidate.payload.status === "accepted" && humanDecision.persistedObjects.length > 0,
        "Human accept decision should update candidate status and persist promoted objects.",
      ),
    ],
    summary: {
      sourceId: sourceResult.object.id,
      sourceCategory: sourceResult.object.payload.category,
      dataItemId: dataItemResult.object.id,
      dataItemCategory: dataItemResult.object.payload.provenance.category,
      sourceTrace: sourceResult.weaveTrace,
      dataItemTrace: dataItemResult.weaveTrace,
      autoReviewAction: autoReview.decision.payload.action,
      autoReviewScore: autoReview.decision.payload.score,
      humanDecisionAction: humanDecision.decision.payload.action,
      persistedObjects: humanDecision.persistedObjects.length,
      curationTrace: humanDecision.decision.payload.weaveTrace,
    },
  };
}

const evaluateIngestionAndCurationOp = weave.op(async function evaluateAttackKbIngestionAndCuration(
  trace: TraceState,
): Promise<EvalCaseResult> {
  return evaluateIngestionAndCuration(trace);
});

function summarizeResponse(response: AttackKbResponse): Record<string, unknown> {
  return {
    phase: response.phase,
    recommendations: response.recommendations.length,
    missingInfo: response.missingInfo.map((item) => item.key),
    kbRefs: response.kbRefs.length,
    retrievedContext: response.retrievedContext
      ? {
          backend: response.retrievedContext.backend,
          resultCount: response.retrievedContext.resultCount,
          indexName: response.retrievedContext.indexName,
          p1SubagentContextRetrieval: response.retrievedContext.p1SubagentContextRetrieval,
        }
      : undefined,
    firstRecommendation: response.recommendations[0]
      ? {
          id: response.recommendations[0].id,
          phase: response.recommendations[0].phase,
          hasComposition: Boolean(response.recommendations[0].composition),
        }
      : undefined,
  };
}

async function runEvalSuite(): Promise<EvalRunResult> {
  const trace = await initWeaveIfAvailable();
  const cases = trace === "enabled"
    ? await Promise.all([
        evaluateEmptyProfileRecommendationOp(trace),
        evaluateRichProfileRecommendationOp(trace),
        evaluateIngestionAndCurationOp(trace),
      ])
    : await Promise.all([
        evaluateEmptyProfileRecommendation(trace),
        evaluateRichProfileRecommendation(trace),
        evaluateIngestionAndCuration(trace),
      ]);
  const passed = cases.filter(caseOk).length;
  const failed = cases.length - passed;
  const totalScoreCount = cases.reduce((sum, item) => sum + item.scores.length, 0);
  const totalScore = cases.reduce(
    (sum, item) => sum + item.scores.reduce((caseSum, scoreItem) => caseSum + scoreItem.score, 0),
    0,
  );

  return {
    ok: failed === 0,
    generatedAt: new Date().toISOString(),
    trace,
    cases,
    totals: {
      passed,
      failed,
      score: totalScore / totalScoreCount,
    },
  };
}

try {
  const result = await runEvalSuite();
  await recordAttackKbEvent({
    type: "eval_run_completed",
    source: "attack-kb.evals",
    timestamp: result.generatedAt,
    payload: {
      ok: result.ok,
      trace: result.trace,
      totals: result.totals,
      caseIds: result.cases.map((item) => item.id),
    },
  });
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  await closeDefaultAttackKbStorageAdapter();
}
