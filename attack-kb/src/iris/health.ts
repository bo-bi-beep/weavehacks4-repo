import "dotenv/config";

import { getAttackKbLlmCacheConfig, isLangCacheConfigured } from "../cache/index.js";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function set(name: string): "set" | "missing" {
  return env(name) ? "set" : "missing";
}

function configured(keys: string[]): boolean {
  return keys.every((key) => Boolean(env(key)));
}

const cacheConfig = getAttackKbLlmCacheConfig();

const report = {
  generatedAt: new Date().toISOString(),
  purpose: "sanitized Redis Iris managed-service readiness report",
  redisDatabase: {
    configured: Boolean(env("REDIS_URL")),
    note:
      "REDIS_URL backs RedisJSON, Query Engine, and vector search. Managed Iris services need separate service credentials below.",
  },
  langCache: {
    configured: isLangCacheConfigured(cacheConfig),
    env: {
      LANGCACHE_HOST: set("LANGCACHE_HOST"),
      LANGCACHE_CACHE_ID: set("LANGCACHE_CACHE_ID"),
      LANGCACHE_API_KEY: set("LANGCACHE_API_KEY"),
      LANGCACHE_THRESHOLD: env("LANGCACHE_THRESHOLD") || String(cacheConfig.langCache.similarityThreshold),
      ATTACK_KB_LANGCACHE_SEARCH_STRATEGIES: env("ATTACK_KB_LANGCACHE_SEARCH_STRATEGIES") || cacheConfig.langCache.searchStrategies.join(","),
    },
    cli: "npm run attack-kb:langcache-smoke -- --flush",
  },
  agentMemory: {
    configured: configured(["MEMORY_API_BASE_URL", "MEMORY_STORE_ID", "MEMORY_API_KEY"]),
    env: {
      MEMORY_API_BASE_URL: set("MEMORY_API_BASE_URL"),
      MEMORY_STORE_ID: set("MEMORY_STORE_ID"),
      MEMORY_API_KEY: set("MEMORY_API_KEY"),
      MEMORY_OWNER_ID: env("MEMORY_OWNER_ID") || "attack-kb-demo",
      MEMORY_ACTOR_ID: env("MEMORY_ACTOR_ID") || "attack-kb",
      MEMORY_NAMESPACE: env("MEMORY_NAMESPACE") || "attack-kb",
    },
    note: "Managed Redis Agent Memory is a separate REST service. The current Redis KV memory adapter remains available until these credentials are set and wired.",
  },
  contextRetriever: {
    configured: configured(["MCP_AGENT_KEY"]),
    env: {
      CTX_ADMIN_KEY: set("CTX_ADMIN_KEY"),
      CTX_SURFACE_ID: set("CTX_SURFACE_ID"),
      MCP_AGENT_KEY: set("MCP_AGENT_KEY"),
      CTX_REDIS_INSTANCE_ID: set("CTX_REDIS_INSTANCE_ID"),
    },
    note: "Context Retriever/Context Surfaces is a separate Redis Cloud managed service that exposes generated MCP tools. Create the service/surface before expecting console visibility.",
  },
};

console.log(JSON.stringify(report, null, 2));

if (!report.langCache.configured || !report.agentMemory.configured || !report.contextRetriever.configured) {
  process.exitCode = 1;
}
