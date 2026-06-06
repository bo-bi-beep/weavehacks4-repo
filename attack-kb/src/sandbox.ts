import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SubAgentService, type AgentSummary, type CreateAgentInput } from "../../agents/sub_agents/index.js";
import { initWeave } from "../../src/lib/weave.js";
import { type AttackKbAgentRole, getAttackKbAgentModelConfig } from "./config.js";

export const ATTACK_KB_SANDBOX_REQUIRED_ENV = ["OPENAI_API_KEY", "BL_API_KEY", "BL_WORKSPACE"] as const;

export type AttackKbSandboxProvider = "blaxel";

export type AttackKbSandboxAgentFiles = {
  folder: string;
  instructionsPath: string;
  taskPath: string;
};

export type AttackKbSandboxAgentSpec = {
  role: AttackKbAgentRole;
  name: string;
  model: string;
  provider: AttackKbSandboxProvider;
  service: "agents/sub_agents/SubAgentService";
  agentFiles: AttackKbSandboxAgentFiles;
  sandbox: {
    provider: "blaxel";
    sharedClient: "src/lib/blaxel.ts:createBlaxelSandboxClient";
    isolation: "one persistent Blaxel micro-VM per Attack KB agent";
    requiredEnv: readonly (typeof ATTACK_KB_SANDBOX_REQUIRED_ENV)[number][];
  };
  createAgentInput: CreateAgentInput;
  safetyBoundary: string;
};

export type CreateAttackKbSandboxAgentOptions = {
  task?: string;
  name?: string;
  service?: SubAgentService;
};

export type CreatedAttackKbSandboxAgent = {
  spec: AttackKbSandboxAgentSpec;
  agent: AgentSummary;
  service: SubAgentService;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATTACK_KB_AGENTS_ROOT = path.join(REPO_ROOT, "agents", "attack_kb");

const roleLabels: Record<AttackKbAgentRole, string> = {
  sourceDiscovery: "Source Discovery",
  sourceRetrieval: "Source Retrieval",
  credibilityTriage: "Credibility Triage",
  kbCurator: "KB Curator",
  recommendationBuilder: "Recommendation Builder",
};

const roleFolders: Record<AttackKbAgentRole, string> = {
  sourceDiscovery: "source-discovery",
  sourceRetrieval: "source-retrieval",
  credibilityTriage: "credibility-triage",
  kbCurator: "kb-curator",
  recommendationBuilder: "recommendation-builder",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function roleFolderPath(role: AttackKbAgentRole): string {
  return path.join(ATTACK_KB_AGENTS_ROOT, roleFolders[role]);
}

function roleFilePath(role: AttackKbAgentRole, fileName: "instructions.md" | "task.md"): string {
  return path.join(roleFolderPath(role), fileName);
}

function readRoleFile(role: AttackKbAgentRole, fileName: "instructions.md" | "task.md"): string {
  return readFileSync(roleFilePath(role, fileName), "utf8").trim();
}

function defaultTaskForRole(role: AttackKbAgentRole): string {
  return readRoleFile(role, "task.md");
}

function agentFilesForRole(role: AttackKbAgentRole): AttackKbSandboxAgentFiles {
  const folder = roleFolderPath(role);
  return {
    folder: path.relative(REPO_ROOT, folder),
    instructionsPath: path.relative(REPO_ROOT, roleFilePath(role, "instructions.md")),
    taskPath: path.relative(REPO_ROOT, roleFilePath(role, "task.md")),
  };
}

export function validateAttackKbSandboxEnv(): string[] {
  return ATTACK_KB_SANDBOX_REQUIRED_ENV.filter((name) => !env(name));
}

export function buildAttackKbSandboxInstructions(role: AttackKbAgentRole): string {
  return readRoleFile(role, "instructions.md");
}

export function buildAttackKbSandboxAgentSpec(
  role: AttackKbAgentRole,
  task = defaultTaskForRole(role),
  name = `Attack KB ${roleLabels[role]}`,
): AttackKbSandboxAgentSpec {
  const modelConfig = getAttackKbAgentModelConfig(role);

  return {
    role,
    name,
    model: modelConfig.model,
    provider: "blaxel",
    service: "agents/sub_agents/SubAgentService",
    agentFiles: agentFilesForRole(role),
    sandbox: {
      provider: "blaxel",
      sharedClient: "src/lib/blaxel.ts:createBlaxelSandboxClient",
      isolation: "one persistent Blaxel micro-VM per Attack KB agent",
      requiredEnv: ATTACK_KB_SANDBOX_REQUIRED_ENV,
    },
    createAgentInput: {
      name,
      model: modelConfig.model,
      instructions: buildAttackKbSandboxInstructions(role),
      task,
    },
    safetyBoundary:
      "Attack KB agents run in Blaxel sandboxes for isolated analysis only. They do not directly contact the Agent Under Test, do not execute attacks, and do not receive raw Redis admin credentials.",
  };
}

/**
 * Create a live Attack KB sandbox agent using the same Blaxel-backed
 * SubAgentService pattern as the repo's main/sub-agent use case.
 *
 * Deterministic demos should call buildAttackKbSandboxAgentSpec() instead; this
 * function requires real OpenAI + Blaxel credentials because it creates a live
 * sandbox-backed agent record ready for model turns and terminal commands.
 */
export async function createAttackKbSandboxAgent(
  role: AttackKbAgentRole,
  options: CreateAttackKbSandboxAgentOptions = {},
): Promise<CreatedAttackKbSandboxAgent> {
  const missing = validateAttackKbSandboxEnv();
  if (missing.length > 0) {
    throw new Error(`Missing Attack KB sandbox environment variable(s): ${missing.join(", ")}`);
  }

  await initWeave();

  const service = options.service ?? new SubAgentService();
  const spec = buildAttackKbSandboxAgentSpec(role, options.task, options.name);
  const agent = await service.createAgent(spec.createAgentInput);

  return { spec, agent, service };
}
