import "dotenv/config";

import { getAttackKbRecommendations } from "./recommendations.js";
import type { AgentUnderTestProfile } from "./types.js";

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

const rawArgs = process.argv.slice(2);
const rawProfile = rawArgs.join(" ").trim();
const profile: AgentUnderTestProfile = rawArgs.includes("--rich-credit-loan")
  ? richCreditLoanProfile
  : rawProfile
    ? (JSON.parse(rawProfile) as AgentUnderTestProfile)
    : { domain: "credit_loan" };

console.log(JSON.stringify(getAttackKbRecommendations(profile), null, 2));
