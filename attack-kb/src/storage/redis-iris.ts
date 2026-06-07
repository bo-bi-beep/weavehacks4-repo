import type { AttackKbCanonicalObject } from "../types.js";
import {
  createAttackKbRedisClient,
  type AttackKbRedisClient,
  type AttackKbRedisUrlSource,
} from "../redis/client.js";
import {
  ensureAttackKbObjectSearchIndex,
  searchAttackKbObjectIds,
  shouldUseAttackKbRedisQueryEngine,
  type AttackKbRedisQueryEngineState,
} from "../redis/query-engine.js";
import { matchesAttackKbStorageQuery } from "./query.js";
import type { AttackKbStorageAdapter, AttackKbStorageQuery } from "./types.js";

export type RedisIrisAttackKbStorageConfig = {
  url?: string;
  urlSource?: AttackKbRedisUrlSource;
  indexName: string;
  namespace: string;
  fallbackToLocal: boolean;
};

export type RedisIrisAttackKbStorageOptions = {
  config: RedisIrisAttackKbStorageConfig;
  fallback?: AttackKbStorageAdapter;
};

type RedisDocumentMode = "redis-json" | "string-json";

type RedisConnectionState = {
  client: AttackKbRedisClient;
  documentMode: RedisDocumentMode;
  queryEngine?: AttackKbRedisQueryEngineState;
};

const FALLBACK_WARNING_CODE = "ATTACK_KB_REDIS_IRIS_FALLBACK";
const STRING_MODE_WARNING_CODE = "ATTACK_KB_REDIS_IRIS_STRING_JSON";
const QUERY_ENGINE_WARNING_CODE = "ATTACK_KB_REDIS_QUERY_ENGINE_UNAVAILABLE";

let warnedAboutFallback = false;
let warnedAboutStringMode = false;
let warnedAboutQueryEngine = false;

function storagePrefix(config: RedisIrisAttackKbStorageConfig): string {
  return `${config.namespace}:${config.indexName}`;
}

function objectIdsKey(config: RedisIrisAttackKbStorageConfig): string {
  return `${storagePrefix(config)}:ids`;
}

function objectKeyPrefix(config: RedisIrisAttackKbStorageConfig): string {
  return `${storagePrefix(config)}:object:`;
}

function objectKey(config: RedisIrisAttackKbStorageConfig, id: string): string {
  return `${objectKeyPrefix(config)}${id}`;
}

function jsonProbeKey(config: RedisIrisAttackKbStorageConfig): string {
  return `${storagePrefix(config)}:__probe__:json-support`;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/rediss?:\/\/\S+/gi, "<redacted Redis URL>");
}

function fallbackReason(config: RedisIrisAttackKbStorageConfig, reason: string): string {
  return `Redis Attack KB storage unavailable (${reason}); using local fallback for ${config.namespace}/${config.indexName}.`;
}

function warnFallback(config: RedisIrisAttackKbStorageConfig, reason: string): void {
  if (warnedAboutFallback) {
    return;
  }

  process.emitWarning(fallbackReason(config, reason), { code: FALLBACK_WARNING_CODE });
  warnedAboutFallback = true;
}

function warnStringMode(config: RedisIrisAttackKbStorageConfig, reason: string): void {
  if (warnedAboutStringMode) {
    return;
  }

  process.emitWarning(
    `RedisJSON is unavailable for ${config.namespace}/${config.indexName} (${reason}); storing canonical Attack KB objects as string JSON values instead.`,
    { code: STRING_MODE_WARNING_CODE },
  );
  warnedAboutStringMode = true;
}

function warnQueryEngineUnavailable(config: RedisIrisAttackKbStorageConfig, reason: string): void {
  if (warnedAboutQueryEngine) {
    return;
  }

  process.emitWarning(
    `Redis Query Engine search is unavailable for ${config.namespace}/${config.indexName} (${reason}); canonical Attack KB list queries will use Redis key/id scan plus JS-side filtering.`,
    { code: QUERY_ENGINE_WARNING_CODE },
  );
  warnedAboutQueryEngine = true;
}

function missingUrlError(config: RedisIrisAttackKbStorageConfig): Error {
  return new Error(
    [
      "Redis Attack KB storage is selected but no Redis URL is configured.",
      "Set ATTACK_KB_REDIS_IRIS_URL or REDIS_URL to a Redis/Redis Cloud connection URL.",
      "Use rediss:// in the URL when TLS is required.",
      `namespace=${config.namespace}`,
      `index=${config.indexName}`,
    ].join(" "),
  );
}

function fallbackDisabledError(config: RedisIrisAttackKbStorageConfig, reason: string): Error {
  return new Error(
    [
      `Redis Attack KB storage failed and local fallback is disabled: ${reason}.`,
      "Set ATTACK_KB_REDIS_IRIS_FALLBACK=local to allow demo-safe local fallback, or fix the Redis URL/connection.",
      `namespace=${config.namespace}`,
      `index=${config.indexName}`,
    ].join(" "),
  );
}

function redisOperationError(
  config: RedisIrisAttackKbStorageConfig,
  operation: string,
  error: unknown,
): Error {
  return new Error(
    [
      `Redis Attack KB storage ${operation} failed: ${errorMessage(error)}.`,
      `namespace=${config.namespace}`,
      `index=${config.indexName}`,
    ].join(" "),
  );
}

function isRedisJsonUnavailableError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    (message.includes("unknown command") && message.includes("json")) ||
    (message.includes("module") && message.includes("json")) ||
    (message.includes("noperm") && message.includes("json"))
  );
}

function isWrongTypeError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("wrongtype");
}

function isRedisConnectionError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return [
    "econnrefused",
    "econnreset",
    "enotfound",
    "etimedout",
    "socket",
    "connection",
    "connect",
    "closed",
    "the client is closed",
  ].some((needle) => message.includes(needle));
}

function isCanonicalObject(value: unknown): value is AttackKbCanonicalObject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AttackKbCanonicalObject>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.objectType === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.sourceRefs) &&
    Array.isArray(candidate.tags) &&
    typeof candidate.payload === "object" &&
    candidate.payload !== null
  );
}

function parseCanonicalObject(raw: string, key: string): AttackKbCanonicalObject {
  const parsed = JSON.parse(raw) as unknown;

  if (!isCanonicalObject(parsed)) {
    throw new Error(`Invalid Attack KB canonical object stored at Redis key ${key}`);
  }

  return parsed;
}

async function detectDocumentMode(
  client: AttackKbRedisClient,
  config: RedisIrisAttackKbStorageConfig,
): Promise<RedisDocumentMode> {
  const key = jsonProbeKey(config);

  try {
    await client.sendCommand(["JSON.SET", key, "$", JSON.stringify({ ok: true })]);
    await client.sendCommand(["JSON.GET", key]);
    await client.del(key).catch(() => undefined);
    return "redis-json";
  } catch (error) {
    if (!isRedisJsonUnavailableError(error)) {
      throw error;
    }

    warnStringMode(config, errorMessage(error));
    await client.del(key).catch(() => undefined);
    return "string-json";
  }
}

async function jsonSetObject(
  client: AttackKbRedisClient,
  key: string,
  object: AttackKbCanonicalObject,
): Promise<void> {
  const result = await client.sendCommand(["JSON.SET", key, "$", JSON.stringify(object)]);
  if (result !== "OK") {
    throw new Error(`Unexpected JSON.SET reply for ${key}: ${String(result)}`);
  }
}

async function jsonGetObject(
  client: AttackKbRedisClient,
  key: string,
): Promise<AttackKbCanonicalObject | undefined> {
  const raw = await client.sendCommand<string | null>(["JSON.GET", key]);
  if (raw === null) {
    return undefined;
  }

  return parseCanonicalObject(raw, key);
}

async function stringSetObject(
  client: AttackKbRedisClient,
  key: string,
  object: AttackKbCanonicalObject,
): Promise<void> {
  await client.set(key, JSON.stringify(object));
}

async function stringGetObject(
  client: AttackKbRedisClient,
  key: string,
): Promise<AttackKbCanonicalObject | undefined> {
  const raw = await client.get(key);
  if (raw === null) {
    return undefined;
  }

  return parseCanonicalObject(raw, key);
}

export function createRedisIrisAttackKbStorageAdapter(
  options: RedisIrisAttackKbStorageOptions,
): AttackKbStorageAdapter {
  const { config, fallback } = options;
  let connection: Promise<RedisConnectionState> | undefined;
  let lastClientError: Error | undefined;

  async function connect(): Promise<RedisConnectionState> {
    if (!config.url) {
      throw missingUrlError(config);
    }

    const client = createAttackKbRedisClient(
      { url: config.url, urlSource: config.urlSource },
      {
        onError(error) {
          lastClientError = error;
        },
      },
    );

    await client.connect();
    const documentMode = await detectDocumentMode(client, config);
    const queryEngine =
      documentMode === "redis-json"
        ? await ensureAttackKbObjectSearchIndex(client, {
            indexName: config.indexName,
            objectKeyPrefix: objectKeyPrefix(config),
          })
        : undefined;

    if (queryEngine && !queryEngine.available) {
      warnQueryEngineUnavailable(config, queryEngine.reason ?? "FT.CREATE failed");
    }

    return { client, documentMode, queryEngine };
  }

  async function getConnection(): Promise<RedisConnectionState> {
    connection ??= connect().catch((error: unknown) => {
      connection = undefined;
      throw error;
    });

    return connection;
  }

  async function closeRedisConnection(): Promise<void> {
    const current = connection;
    connection = undefined;

    const state = await current?.catch(() => undefined);
    if (!state?.client.isOpen) {
      return;
    }

    await state.client.close().catch(() => {
      state.client.destroy();
    });
  }

  async function requireFallback(reason: string): Promise<AttackKbStorageAdapter> {
    if (fallback && config.fallbackToLocal) {
      warnFallback(config, reason);
      return fallback;
    }

    throw fallbackDisabledError(config, reason);
  }

  async function runWithFallback<T>(
    operation: string,
    redisOperation: (state: RedisConnectionState) => Promise<T>,
    fallbackOperation: (adapter: AttackKbStorageAdapter) => Promise<T>,
  ): Promise<T> {
    let state: RedisConnectionState;

    try {
      state = await getConnection();
    } catch (error) {
      const adapter = await requireFallback(errorMessage(error));
      return fallbackOperation(adapter);
    }

    lastClientError = undefined;

    try {
      return await redisOperation(state);
    } catch (error) {
      if (isRedisConnectionError(error) || (lastClientError && isRedisConnectionError(lastClientError))) {
        await closeRedisConnection();
        const reason = lastClientError ? errorMessage(lastClientError) : errorMessage(error);
        const adapter = await requireFallback(reason);
        return fallbackOperation(adapter);
      }

      throw redisOperationError(config, operation, error);
    }
  }

  async function putRedisObject(
    state: RedisConnectionState,
    object: AttackKbCanonicalObject,
  ): Promise<void> {
    const key = objectKey(config, object.id);

    if (state.documentMode === "redis-json") {
      try {
        await jsonSetObject(state.client, key, object);
      } catch (error) {
        if (!isWrongTypeError(error)) {
          throw error;
        }

        await state.client.del(key);
        await jsonSetObject(state.client, key, object);
      }
    } else {
      await stringSetObject(state.client, key, object);
    }

    await state.client.sAdd(objectIdsKey(config), object.id);
  }

  async function getRedisObject(
    state: RedisConnectionState,
    id: string,
  ): Promise<AttackKbCanonicalObject | undefined> {
    const key = objectKey(config, id);

    if (state.documentMode === "redis-json") {
      try {
        return await jsonGetObject(state.client, key);
      } catch (error) {
        if (!isWrongTypeError(error)) {
          throw error;
        }

        return stringGetObject(state.client, key);
      }
    }

    return stringGetObject(state.client, key);
  }

  async function collectRedisObjectsByIds(
    state: RedisConnectionState,
    ids: string[],
    query: AttackKbStorageQuery,
  ): Promise<AttackKbCanonicalObject[]> {
    const results: AttackKbCanonicalObject[] = [];
    const limit =
      typeof query.limit === "number" && Number.isFinite(query.limit)
        ? Math.max(0, Math.trunc(query.limit))
        : undefined;

    if (limit === 0) {
      return results;
    }

    for (const id of ids) {
      const object = await getRedisObject(state, id);
      if (!object || !matchesAttackKbStorageQuery(object, query)) {
        continue;
      }

      results.push(object);
      if (limit !== undefined && results.length >= limit) {
        break;
      }
    }

    return results;
  }

  async function listRedisObjectsByIdScan(
    state: RedisConnectionState,
    query: AttackKbStorageQuery,
  ): Promise<AttackKbCanonicalObject[]> {
    const ids = Array.isArray(query.ids)
      ? [...new Set(query.ids)]
      : await state.client.sMembers(objectIdsKey(config));

    return collectRedisObjectsByIds(state, ids, query);
  }

  async function listRedisObjectsWithSearch(
    state: RedisConnectionState,
    query: AttackKbStorageQuery,
  ): Promise<AttackKbCanonicalObject[]> {
    if (!state.queryEngine?.available) {
      return listRedisObjectsByIdScan(state, query);
    }

    const searchResult = await searchAttackKbObjectIds(state.client, state.queryEngine, query);
    return collectRedisObjectsByIds(state, searchResult.ids, query);
  }

  async function listRedisObjects(
    state: RedisConnectionState,
    query: AttackKbStorageQuery,
  ): Promise<AttackKbCanonicalObject[]> {
    if (state.queryEngine?.available && shouldUseAttackKbRedisQueryEngine(query)) {
      try {
        return await listRedisObjectsWithSearch(state, query);
      } catch (error) {
        if (isRedisConnectionError(error)) {
          throw error;
        }

        state.queryEngine = {
          ...state.queryEngine,
          available: false,
          status: "unavailable",
          reason: errorMessage(error),
        };
        warnQueryEngineUnavailable(config, errorMessage(error));
      }
    }

    return listRedisObjectsByIdScan(state, query);
  }

  return {
    name: "redis-iris",
    backend: "redis-iris",
    async put(object) {
      await runWithFallback(
        "put",
        (state) => putRedisObject(state, object),
        (adapter) => adapter.put(object),
      );
    },
    async putMany(objects) {
      await runWithFallback(
        "putMany",
        async (state) => {
          for (const object of objects) {
            await putRedisObject(state, object);
          }
        },
        (adapter) => adapter.putMany(objects),
      );
    },
    async get(id) {
      return runWithFallback(
        "get",
        (state) => getRedisObject(state, id),
        (adapter) => adapter.get(id),
      );
    },
    async list(query = {}) {
      return runWithFallback(
        "list",
        (state) => listRedisObjects(state, query),
        (adapter) => adapter.list(query),
      );
    },
    async close() {
      await closeRedisConnection();
      await fallback?.close?.();
    },
  };
}
