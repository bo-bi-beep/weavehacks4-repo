import { join } from "node:path";

import { readAttackKbRedisConnectionConfig, type AttackKbRedisUrlSource } from "../redis/client.js";
import type { AttackKbCanonicalObject } from "../types.js";
import { createLocalAttackKbStorageAdapter } from "./local.js";
import { createRedisIrisAttackKbStorageAdapter } from "./redis-iris.js";
import { buildSeedAttackKbObjects } from "./seeds.js";
import type { AttackKbStorageAdapter } from "./types.js";

export type { AttackKbStorageAdapter, AttackKbStorageQuery } from "./types.js";

export const ATTACK_KB_STORAGE_ADAPTERS = ["local", "json", "redis-iris", "redis"] as const;
export type AttackKbStorageProvider = (typeof ATTACK_KB_STORAGE_ADAPTERS)[number];

export type AttackKbStorageConfig = {
  provider: AttackKbStorageProvider;
  localJsonPath: string;
  redisIris: {
    url?: string;
    urlSource?: AttackKbRedisUrlSource;
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
    `Unsupported ATTACK_KB_REDIS_IRIS_FALLBACK: ${value}. Use "local"/"true" or "disabled"/"false".`,
  );
}

export function getAttackKbStorageConfig(): AttackKbStorageConfig {
  const redisConnection = readAttackKbRedisConnectionConfig();

  return {
    provider: parseProvider(env("ATTACK_KB_STORAGE_ADAPTER")),
    localJsonPath: env("ATTACK_KB_LOCAL_STORAGE_PATH") || join(process.cwd(), "attack-kb", ".local", "kb.json"),
    redisIris: {
      url: redisConnection.url,
      urlSource: redisConnection.urlSource,
      indexName: env("ATTACK_KB_REDIS_IRIS_INDEX") || "attack-kb-objects",
      namespace: env("ATTACK_KB_REDIS_IRIS_NAMESPACE") || "attack-kb",
      fallbackToLocal: parseFallback(env("ATTACK_KB_REDIS_IRIS_FALLBACK")),
    },
  };
}

function seedAdapterWhenEmpty(
  adapter: AttackKbStorageAdapter,
  seedObjects: AttackKbCanonicalObject[],
): AttackKbStorageAdapter {
  let seedPromise: Promise<void> | undefined;

  async function ensureSeeded(): Promise<void> {
    if (seedObjects.length === 0) {
      return;
    }

    seedPromise ??= (async () => {
      const existing = await adapter.list({ limit: 1 });
      if (existing.length === 0) {
        await adapter.putMany(seedObjects);
      }
    })().catch((error: unknown) => {
      seedPromise = undefined;
      throw error;
    });

    await seedPromise;
  }

  return {
    ...adapter,
    async put(object) {
      await ensureSeeded();
      await adapter.put(object);
    },
    async putMany(objects) {
      await ensureSeeded();
      await adapter.putMany(objects);
    },
    async get(id) {
      await ensureSeeded();
      return adapter.get(id);
    },
    async list(query) {
      await ensureSeeded();
      return adapter.list(query);
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

  return seedAdapterWhenEmpty(
    createRedisIrisAttackKbStorageAdapter({
      config: config.redisIris,
      fallback: createLocalAttackKbStorageAdapter({
        name: "attack-kb-redis-iris-local-fallback",
        seedObjects,
      }),
    }),
    seedObjects,
  );
}

let defaultAdapter: AttackKbStorageAdapter | undefined;

export function getDefaultAttackKbStorageAdapter(): AttackKbStorageAdapter {
  defaultAdapter ??= createAttackKbStorageAdapter();
  return defaultAdapter;
}

export function resetDefaultAttackKbStorageAdapterForTests(): void {
  defaultAdapter = undefined;
}
