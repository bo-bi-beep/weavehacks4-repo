import "dotenv/config";

import { getAttackKbLlmCacheConfig } from "./cache/index.js";
import {
  ATTACK_KB_AGENT_ROLES,
  getAttackKbRuntimeConfig,
  validateAttackKbRuntimeEnv,
} from "./config.js";
import { getAttackKbMemoryConfig } from "./memory/index.js";
import { getAttackKbVectorRetrievalConfig } from "./retrieval/index.js";
import { getAttackKbStorageConfig } from "./storage/index.js";

const config = getAttackKbRuntimeConfig();
const storageConfig = getAttackKbStorageConfig();
const memoryConfig = getAttackKbMemoryConfig();
const cacheConfig = getAttackKbLlmCacheConfig();
const retrievalConfig = getAttackKbVectorRetrievalConfig();
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
        seedOnEmpty: storageConfig.seedOnEmpty,
        redisIris: {
          url: storageConfig.redisIris.url ? "set" : "missing",
          urlSource: storageConfig.redisIris.urlSource ?? null,
          indexName: storageConfig.redisIris.indexName,
          namespace: storageConfig.redisIris.namespace,
          fallbackToLocal: storageConfig.redisIris.fallbackToLocal,
        },
      },
      memory: {
        adapter: memoryConfig.provider,
        redis: {
          url: memoryConfig.redis.url ? "set" : "missing",
          keyPrefix: memoryConfig.redis.keyPrefix,
          fallbackToLocal: memoryConfig.redis.fallbackToLocal,
          timeoutMs: memoryConfig.redis.timeoutMs,
        },
      },
      llmCache: {
        provider: cacheConfig.provider,
        ttlSeconds: cacheConfig.ttlSeconds,
        redis: {
          url: cacheConfig.redis.url ? "set" : "missing",
          keyPrefix: cacheConfig.redis.keyPrefix,
          fallbackToLocal: cacheConfig.redis.fallbackToLocal,
          timeoutMs: cacheConfig.redis.timeoutMs,
        },
        langCache: {
          host: cacheConfig.langCache.host ? "set" : "missing",
          cacheId: cacheConfig.langCache.cacheId ? "set" : "missing",
          apiKey: cacheConfig.langCache.apiKey ? "set" : "missing",
          similarityThreshold: cacheConfig.langCache.similarityThreshold,
          useAttributes: cacheConfig.langCache.useAttributes,
          fallbackToLocal: cacheConfig.langCache.fallbackToLocal,
          timeoutMs: cacheConfig.langCache.timeoutMs,
        },
      },
      retrieval: {
        backend: retrievalConfig.backend,
        embedding: {
          provider: retrievalConfig.embedding.provider,
          dimensions: retrievalConfig.embedding.dimensions,
          openAIModel: retrievalConfig.embedding.openAIModel,
          deterministicSeed: retrievalConfig.embedding.deterministicSeed ? "set" : "missing",
        },
        redisVector: {
          url: retrievalConfig.redis.url ? "set" : "missing",
          urlSource: retrievalConfig.redis.urlSource ?? null,
          indexName: retrievalConfig.redis.indexName,
          keyPrefix: retrievalConfig.redis.keyPrefix,
          indexAlgorithm: retrievalConfig.redis.indexAlgorithm,
          materializeOnSearch: retrievalConfig.redis.materializeOnSearch,
          fallbackToLocal: retrievalConfig.redis.fallbackToLocal,
        },
        maxChunkChars: retrievalConfig.maxChunkChars,
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
