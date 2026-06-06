import { join } from "node:path";

import { createLocalAttackKbStorageAdapter } from "./local.js";
import { createRedisIrisAttackKbStorageAdapter } from "./redis-iris.js";
import { buildSeedAttackKbObjects } from "./seeds.js";
import type { AttackKbStorageAdapter } from "./types.js";

export type { AttackKbStorageAdapter, AttackKbStorageQuery } from "./types.js";

export const ATTACK_KB_STORAGE_ADAPTERS = ["local", "json", "redis-iris"] as const;
export type AttackKbStorageProvider = (typeof ATTACK_KB_STORAGE_ADAPTERS)[number];

export type AttackKbStorageConfig = {
  provider: AttackKbStorageProvider;
  localJsonPath: string;
  redisIris: {
    url?: string;
    indexName: string;
    namespace: string;
    fallbackToLocal: boolean;
  };
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseProvider(value: string | undefined): AttackKbStorageProvider {
  const provider = value?.toLowerCase() || "local";

  if (!ATTACK_KB_STORAGE_ADAPTERS.includes(provider as AttackKbStorageProvider)) {
    throw new Error(
      `Unsupported ATTACK_KB_STORAGE_ADAPTER: ${provider}. Supported values: ${ATTACK_KB_STORAGE_ADAPTERS.join(", ")}`,
    );
  }

  return provider as AttackKbStorageProvider;
}

function parseFallback(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  if (!normalized || normalized === "local" || normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "disabled" || normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(
    `Unsupported ATTACK_KB_REDIS_IRIS_FALLBACK: ${value}. Use "local" or "disabled".`,
  );
}

export function getAttackKbStorageConfig(): AttackKbStorageConfig {
  return {
    provider: parseProvider(env("ATTACK_KB_STORAGE_ADAPTER")),
    localJsonPath: env("ATTACK_KB_LOCAL_STORAGE_PATH") || join(process.cwd(), "attack-kb", ".local", "kb.json"),
    redisIris: {
      url: env("ATTACK_KB_REDIS_IRIS_URL"),
      indexName: env("ATTACK_KB_REDIS_IRIS_INDEX") || "attack-kb-objects",
      namespace: env("ATTACK_KB_REDIS_IRIS_NAMESPACE") || "attack-kb",
      fallbackToLocal: parseFallback(env("ATTACK_KB_REDIS_IRIS_FALLBACK")),
    },
  };
}

export function createAttackKbStorageAdapter(
  config: AttackKbStorageConfig = getAttackKbStorageConfig(),
): AttackKbStorageAdapter {
  const seedObjects = buildSeedAttackKbObjects();

  if (config.provider === "local") {
    return createLocalAttackKbStorageAdapter({
      name: "attack-kb-local-memory",
      seedObjects,
    });
  }

  if (config.provider === "json") {
    return createLocalAttackKbStorageAdapter({
      name: "attack-kb-local-json",
      seedObjects,
      jsonPath: config.localJsonPath,
    });
  }

  return createRedisIrisAttackKbStorageAdapter({
    config: config.redisIris,
    fallback: createLocalAttackKbStorageAdapter({
      name: "attack-kb-redis-iris-local-fallback",
      seedObjects,
    }),
  });
}

let defaultAdapter: AttackKbStorageAdapter | undefined;

export function getDefaultAttackKbStorageAdapter(): AttackKbStorageAdapter {
  defaultAdapter ??= createAttackKbStorageAdapter();
  return defaultAdapter;
}

export function resetDefaultAttackKbStorageAdapterForTests(): void {
  defaultAdapter = undefined;
}
