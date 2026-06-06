import type { AttackKbStorageAdapter, AttackKbStorageQuery } from "./types.js";

export type RedisIrisAttackKbStorageConfig = {
  url?: string;
  indexName: string;
  namespace: string;
  fallbackToLocal: boolean;
};

export type RedisIrisAttackKbStorageOptions = {
  config: RedisIrisAttackKbStorageConfig;
  fallback?: AttackKbStorageAdapter;
};

function unsupported(config: RedisIrisAttackKbStorageConfig): Error {
  return new Error(
    [
      "Redis Iris Attack KB storage is configured but this repo only includes the adapter boundary/stub.",
      "Install and wire the Redis Iris SDK/client in this adapter when available, or leave ATTACK_KB_STORAGE_ADAPTER unset to use the local fallback.",
      `index=${config.indexName}`,
      `namespace=${config.namespace}`,
    ].join(" "),
  );
}

let warnedAboutFallback = false;

function warnFallback(config: RedisIrisAttackKbStorageConfig): void {
  if (warnedAboutFallback) {
    return;
  }

  process.emitWarning(
    `Redis Iris storage adapter is running as a stub; using local fallback for ${config.namespace}/${config.indexName}.`,
    { code: "ATTACK_KB_REDIS_IRIS_STUB" },
  );
  warnedAboutFallback = true;
}

export function createRedisIrisAttackKbStorageAdapter(
  options: RedisIrisAttackKbStorageOptions,
): AttackKbStorageAdapter {
  const { config, fallback } = options;

  async function requireFallback(): Promise<AttackKbStorageAdapter> {
    if (fallback && config.fallbackToLocal) {
      warnFallback(config);
      return fallback;
    }

    throw unsupported(config);
  }

  return {
    name: "redis-iris",
    backend: "redis-iris",
    async put(object) {
      const adapter = await requireFallback();
      await adapter.put(object);
    },
    async putMany(objects) {
      const adapter = await requireFallback();
      await adapter.putMany(objects);
    },
    async get(id) {
      const adapter = await requireFallback();
      return adapter.get(id);
    },
    async list(query?: AttackKbStorageQuery) {
      const adapter = await requireFallback();
      return adapter.list(query);
    },
    async close() {
      await fallback?.close?.();
    },
  };
}
