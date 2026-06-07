import "dotenv/config";

import { createAttackKbServer } from "./server.js";
import { closeDefaultAttackKbStorageAdapter } from "./storage/index.js";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { error?: string };
  if (!response.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${response.status}`);
  }
  return json;
}

const server = createAttackKbServer();
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
if (!address || typeof address !== "object") {
  throw new Error("Expected Attack KB server to listen on a TCP port.");
}

const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const body = {
    profile: {
      domain: "credit_loan",
      techStack: ["LLM loan assistant", "RAG policy documents", "credit-score lookup tool"],
      tools: ["credit_score_lookup", "adverse_action_notice_generator", "document_retriever"],
      memoryOrRag: ["retrieves lending policy snippets", "stores applicant conversation history"],
      permissions: ["borrower chat channel", "synthetic tool access through harness"],
      policies: [
        "must not disclose sensitive applicant data",
        "must provide accurate adverse action reasons",
        "borrower chat should not grant underwriter/admin authority"
      ],
      observedBehavior: [
        {
          summary: "Synthetic target uses retrieved policy snippets in rationale.",
          evidence: "Fictional applicant flow cited lending policy text.",
          confidence: 0.8
        }
      ],
      observedDecisionFactors: [
        {
          factorRef: "factor-credit-score",
          evidence: "Target asked for and referenced credit score in synthetic profile.",
          confidence: 0.85
        },
        {
          factorRef: "factor-income",
          evidence: "Target requested income before approval posture.",
          confidence: 0.7
        }
      ]
    },
    options: {
      mainIrisContext: { limit: 12 },
      recommendationBuilder: { mode: "openai", maxRecommendations: 4 }
    }
  };

  const result = await postJson(`${baseUrl}/api/recommendations`, body) as {
    phase?: string;
    recommendationBuilderCache?: { provider: string; hit: boolean; exact: boolean; task: string; model: string };
    artifactSelection?: { selectedRefs?: Array<{ id: string; storageType: string; selectedFrom: string; score?: number; contextRetriever?: { toolName?: string; status: string; error?: string } }> };
    recommendations?: Array<{
      id: string;
      attackerGoal?: string;
      targetOutcome?: string;
      payloadTemplateRefs?: string[];
      derivedArtifactRefs?: Array<{ id: string; storageType: string; title: string }>;
      sampleScenarios?: Array<{ turns?: Array<{ speaker: string; content: string }> }>;
    }>;
  };

  console.log(JSON.stringify({
    ok: true,
    phase: result.phase,
    recommendationBuilderCache: result.recommendationBuilderCache,
    contextRetriever: {
      hydrated: result.artifactSelection?.selectedRefs?.filter((ref) => ref.contextRetriever?.status === "hydrated").length ?? 0,
      errors: result.artifactSelection?.selectedRefs?.filter((ref) => ref.contextRetriever?.status === "error").map((ref) => ({ id: ref.id, error: ref.contextRetriever?.error })) ?? [],
    },
    selectedArtifacts: result.artifactSelection?.selectedRefs?.map((ref) => ({
      id: ref.id,
      type: ref.storageType,
      selectedFrom: ref.selectedFrom,
      score: ref.score,
      contextRetriever: ref.contextRetriever,
    })),
    recommendations: result.recommendations?.map((recommendation) => ({
      id: recommendation.id,
      attackerGoal: recommendation.attackerGoal,
      targetOutcome: recommendation.targetOutcome,
      payloadTemplateRefs: recommendation.payloadTemplateRefs,
      refs: recommendation.derivedArtifactRefs?.map((ref) => `${ref.storageType}:${ref.id}`),
      sampleTurns: recommendation.sampleScenarios?.[0]?.turns,
    })),
  }, null, 2));
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await closeDefaultAttackKbStorageAdapter();
}
