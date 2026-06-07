import "dotenv/config";

import { ATTACK_KB_AGENT_ROLES, type AttackKbAgentRole } from "./config.js";
import { buildAttackKbSandboxAgentSpec, validateAttackKbSandboxEnv } from "./sandbox.js";

function parseRole(value: string | undefined): AttackKbAgentRole {
  if (!value) return "recommendationBuilder";
  if ((ATTACK_KB_AGENT_ROLES as readonly string[]).includes(value)) {
    return value as AttackKbAgentRole;
  }

  throw new Error(
    `Unknown Attack KB role ${JSON.stringify(value)}. Expected one of: ${ATTACK_KB_AGENT_ROLES.join(", ")}`,
  );
}

const [roleArg, ...taskParts] = process.argv.slice(2);
const role = parseRole(roleArg);
const task = taskParts.join(" ").trim() || undefined;
const spec = buildAttackKbSandboxAgentSpec(role, task);
const missingForLiveLaunch = validateAttackKbSandboxEnv();

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: "dry_run_no_blaxel_launch",
      message:
        "Attack KB sandbox config mirrors agents/sub_agents Blaxel SubAgentService. Set missing env vars before live creation.",
      missingForLiveLaunch,
      spec: {
        role: spec.role,
        name: spec.name,
        model: spec.model,
        provider: spec.provider,
        service: spec.service,
        agentFiles: spec.agentFiles,
        sandbox: spec.sandbox,
        safetyBoundary: spec.safetyBoundary,
        createAgentInput: {
          name: spec.createAgentInput.name,
          model: spec.createAgentInput.model,
          task: spec.createAgentInput.task,
          instructionsPreview: `${spec.createAgentInput.instructions?.slice(0, 360)}...`,
        },
      },
    },
    null,
    2,
  ),
);
