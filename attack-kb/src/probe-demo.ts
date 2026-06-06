import "dotenv/config";

import { getAttackKbRecommendations } from "./recommendations.js";
import type { AgentUnderTestProfile } from "./types.js";

const rawProfile = process.argv.slice(2).join(" ").trim();
const profile: AgentUnderTestProfile = rawProfile ? (JSON.parse(rawProfile) as AgentUnderTestProfile) : { domain: "credit_loan" };

console.log(JSON.stringify(getAttackKbRecommendations(profile), null, 2));
