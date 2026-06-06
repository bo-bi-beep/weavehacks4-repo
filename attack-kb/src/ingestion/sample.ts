import type { AttackKbDataItemIngestionInput, AttackKbSourceIngestionInput } from "./index.js";

export const sampleOwaspAgenticSource: AttackKbSourceIngestionInput = {
  id: "source-owasp-agentic-prompt-injection-demo",
  title: "OWASP-style agentic prompt-injection source sample",
  description:
    "Manual sample source representing standards-backed agentic-risk language for defensive Attack KB curation testing.",
  category: "owasp",
  sourceType: "standard",
  url: "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
  provenance: {
    originLabel: "OWASP Top 10 for LLM Applications",
    publisher: "OWASP",
    retrievedBy: "manual",
    standardsRefs: ["OWASP LLM Top 10", "LLM01 Prompt Injection", "agentic risk"],
  },
  evidence: [
    {
      summary:
        "Prompt injection and tool-mediated agent behavior should be curated as source-backed safety risk material before becoming canonical KB guidance.",
      excerpt:
        "Attackers may craft inputs that override instructions or influence tool-using agent behavior; use this only as defensive taxonomy context.",
      locator: "manual sample excerpt",
      confidence: 0.9,
    },
  ],
  suggestedObjectTypes: ["vulnerability", "attack_pattern", "system_attack_pattern", "evidence_source"],
  tags: ["manual-sample", "no-openai"],
};

export function buildSampleMaestroDataItem(sourceRef: string): AttackKbDataItemIngestionInput {
  return {
    id: "data-maestro-agentic-risk-control-demo",
    title: "MAESTRO-style agentic risk control sample",
    dataType: "agentic_risk_note",
    category: "maestro_agentic_risk",
    sourceRef,
    content:
      "Agentic systems should treat planning, tool access, memory, and delegation as separately reviewable risk surfaces. Curate this note before promoting it into a vulnerability, attack pattern, or success signal.",
    provenance: {
      originLabel: "Manual MAESTRO-style agentic risk note",
      retrievedBy: "manual",
      standardsRefs: ["MAESTRO-style agentic risk", "tool access", "memory risk", "delegation risk"],
    },
    evidence: [
      {
        summary:
          "The note maps agentic control surfaces to curation targets without producing executable attack instructions.",
        locator: "manual sample data item",
        confidence: 0.82,
      },
    ],
    suggestedObjectTypes: ["vulnerability", "attack_pattern", "success_signal"],
    tags: ["manual-sample", "no-openai"],
  };
}
