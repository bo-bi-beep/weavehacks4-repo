import "dotenv/config";

import {
  ATTACK_KB_AGENT_ROLES,
  getAttackKbRuntimeConfig,
  validateAttackKbRuntimeEnv,
} from "./config.js";
import { getAttackKbStorageConfig } from "./storage/index.js";

const config = getAttackKbRuntimeConfig();
const storageConfig = getAttackKbStorageConfig();
const missing = validateAttackKbRuntimeEnv(config);

console.log(
  JSON.stringify(
    {
      provider: config.provider,
      weaveProject: config.weaveProject,
      keys: {
        [config.openAIKeyEnv]: process.env[config.openAIKeyEnv]?.trim() ? "set" : "missing",
        [config.wandbKeyEnv]: process.env[config.wandbKeyEnv]?.trim() ? "set" : "missing",
      },
      agentModels: Object.fromEntries(
        ATTACK_KB_AGENT_ROLES.map((role) => [role, config.models[role].model]),
      ),
      storage: {
        adapter: storageConfig.provider,
        localJsonPath: storageConfig.localJsonPath,
        redisIris: {
          url: storageConfig.redisIris.url ? "set" : "missing",
          indexName: storageConfig.redisIris.indexName,
          namespace: storageConfig.redisIris.namespace,
          fallbackToLocal: storageConfig.redisIris.fallbackToLocal,
        },
      },
      missing,
    },
    null,
    2,
  ),
);

if (missing.length > 0) {
  process.exitCode = 1;
}
