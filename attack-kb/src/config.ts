import { getWeaveProjectName } from "../../src/lib/weave.js";

export const ATTACK_KB_AGENT_ROLES = [
  "sourceGathering",
  "credibilityTriage",
  "kbCurator",
  "recommendationBuilder",
] as const;

export type AttackKbAgentRole = (typeof ATTACK_KB_AGENT_ROLES)[number];

export type AttackKbLlmProvider = "openai";

export type AttackKbAgentModelConfig = {
  role: AttackKbAgentRole;
  provider: AttackKbLlmProvider;
  model: string;
  apiKeyEnv: "OPENAI_API_KEY";
};

export type AttackKbRuntimeConfig = {
  provider: AttackKbLlmProvider;
  openAIKeyEnv: "OPENAI_API_KEY";
  wandbKeyEnv: "WANDB_API_KEY";
  weaveProject: string;
  models: Record<AttackKbAgentRole, AttackKbAgentModelConfig>;
};

const roleModelEnvNames: Record<AttackKbAgentRole, string> = {
  sourceGathering: "ATTACK_KB_SOURCE_GATHERING_MODEL",
  credibilityTriage: "ATTACK_KB_CREDIBILITY_TRIAGE_MODEL",
  kbCurator: "ATTACK_KB_CURATOR_MODEL",
  recommendationBuilder: "ATTACK_KB_RECOMMENDER_MODEL",
};

const defaultRoleModels: Record<AttackKbAgentRole, string> = {
  sourceGathering: "gpt-5.4-mini",
  credibilityTriage: "gpt-5.5",
  kbCurator: "gpt-5.5",
  recommendationBuilder: "gpt-5.5",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseProvider(value: string | undefined): AttackKbLlmProvider {
  const provider = value?.trim().toLowerCase() || "openai";

  if (provider !== "openai") {
    throw new Error(
      `Unsupported ATTACK_KB_LLM_PROVIDER: ${provider}. P0 supports "openai" direct API calls.`,
    );
  }

  return provider;
}

export function getAttackKbRuntimeConfig(): AttackKbRuntimeConfig {
  const provider = parseProvider(env("ATTACK_KB_LLM_PROVIDER"));
  const models = {} as Record<AttackKbAgentRole, AttackKbAgentModelConfig>;

  for (const role of ATTACK_KB_AGENT_ROLES) {
    models[role] = {
      role,
      provider,
      model: env(roleModelEnvNames[role]) || defaultRoleModels[role],
      apiKeyEnv: "OPENAI_API_KEY",
    };
  }

  return {
    provider,
    openAIKeyEnv: "OPENAI_API_KEY",
    wandbKeyEnv: "WANDB_API_KEY",
    weaveProject: getWeaveProjectName(),
    models,
  };
}

export function getAttackKbAgentModelConfig(role: AttackKbAgentRole): AttackKbAgentModelConfig {
  return getAttackKbRuntimeConfig().models[role];
}

export function validateAttackKbRuntimeEnv(config = getAttackKbRuntimeConfig()): string[] {
  const missing: string[] = [];

  if (!env(config.openAIKeyEnv)) {
    missing.push(config.openAIKeyEnv);
  }

  if (!env(config.wandbKeyEnv)) {
    missing.push(config.wandbKeyEnv);
  }

  return missing;
}

export function requireAttackKbRuntimeConfig(): AttackKbRuntimeConfig {
  const config = getAttackKbRuntimeConfig();
  const missing = validateAttackKbRuntimeEnv(config);

  if (missing.length > 0) {
    throw new Error(`Missing Attack KB runtime environment variable(s): ${missing.join(", ")}`);
  }

  return config;
}
