import { OpenAI } from "openai";

import { initWeave, requireEnv, weave } from "../../src/lib/weave.js";
import {
  type AttackKbAgentRole,
  type AttackKbAgentModelConfig,
  getAttackKbAgentModelConfig,
  requireAttackKbRuntimeConfig,
} from "./config.js";

export type AttackKbAgentRuntime = {
  role: AttackKbAgentRole;
  model: string;
  modelConfig: AttackKbAgentModelConfig;
  client: OpenAI;
};

let tracedOpenAIClient: OpenAI | undefined;

function getTracedOpenAIClient(): OpenAI {
  if (!tracedOpenAIClient) {
    // The current Weave npm typings lag the latest OpenAI SDK typings a bit,
    // so we cast through `any` here while still using the real wrapped client at runtime.
    tracedOpenAIClient = weave.wrapOpenAI(
      new OpenAI({
        apiKey: requireEnv("OPENAI_API_KEY"),
      }) as any,
    ) as OpenAI;
  }

  return tracedOpenAIClient;
}

export async function createAttackKbAgentRuntime(role: AttackKbAgentRole): Promise<AttackKbAgentRuntime> {
  requireAttackKbRuntimeConfig();
  await initWeave();

  const modelConfig = getAttackKbAgentModelConfig(role);

  return {
    role,
    model: modelConfig.model,
    modelConfig,
    client: getTracedOpenAIClient(),
  };
}
