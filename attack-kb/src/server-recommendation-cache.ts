import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { createAttackKbRedisClient, readAttackKbRedisConnectionConfig, type AttackKbRedisClient } from "./redis/client.js";
import type { AttackKbRecommendationOptions } from "./recommendations.js";
import type { AgentUnderTestProfile, AttackKbResponse } from "./types.js";

export type AttackKbCachedRecommendationRequestBody = {
  profile?: AgentUnderTestProfile;
  options?: Pick<AttackKbRecommendationOptions, "requestId" | "mainIrisContext" | "recommendationBuilder">;
};

export type AttackKbRecommendationResponseCacheProvider = "disabled" | "local" | "redis";

export type AttackKbRecommendationResponseCacheMetadata = {
  provider: AttackKbRecommendationResponseCacheProvider;
  hit: boolean;
  key: string;
  inputHash: string;
  createdAt?: string;
  expiresAt?: string;
  servedAt: string;
  cachedRequestId?: string;
  timings?: {
    cacheLookupMs: number;
    loaderMs?: number;
    cacheSetMs?: number;
    totalMs: number;
  };
  requestFingerprintExcludes: ["options.requestId"];
};

export type AttackKbCachedRecommendationResponse = AttackKbResponse & {
  serverRecommendationCache: AttackKbRecommendationResponseCacheMetadata;
};

type AttackKbRecommendationResponseCacheConfig = {
  provider: AttackKbRecommendationResponseCacheProvider;
  ttlSeconds: number;
  redis: {
    url?: string;
    keyPrefix: string;
    fallbackToLocal: boolean;
  };
};

type StoredAttackKbRecommendationResponse = {
  version: typeof CACHE_ENTRY_VERSION;
  inputHash: string;
  response: AttackKbResponse;
  createdAt: string;
  expiresAt: string;
};

type AttackKbRecommendationResponseCacheKey = {
  key: string;
  inputHash: string;
};

type AttackKbRecommendationResponseCacheHit = AttackKbRecommendationResponseCacheKey & StoredAttackKbRecommendationResponse & {
  provider: AttackKbRecommendationResponseCacheProvider;
};

type AttackKbRecommendationResponseCacheSetResult = AttackKbRecommendationResponseCacheKey & {
  provider: AttackKbRecommendationResponseCacheProvider;
  createdAt: string;
  expiresAt: string;
};

const CACHE_KEY_VERSION = 1;
const CACHE_ENTRY_VERSION = 1;
const DEFAULT_TTL_SECONDS = 86_400;
const DEFAULT_KEY_PREFIX = "attack-kb:recommendation-response-cache";

let defaultCache: AttackKbRecommendationResponseCache | undefined;
let warnedAboutRedisFallback = false;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

function parseProvider(
  value: string | undefined,
  hasRedisUrl: boolean,
): AttackKbRecommendationResponseCacheProvider {
  const normalized = value?.toLowerCase();

  if (!normalized) {
    return hasRedisUrl ? "redis" : "local";
  }

  if (["disabled", "disable", "off", "false", "0", "none", "noop", "no-op"].includes(normalized)) {
    return "disabled";
  }

  if (["local", "memory", "in-memory"].includes(normalized)) {
    return "local";
  }

  if (normalized === "redis") {
    return "redis";
  }

  throw new Error(
    `Unsupported ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE: ${value}. Supported values: disabled, local, redis.`,
  );
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = env(name);

  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ${name}: ${raw}. Use a positive integer.`);
  }

  return parsed;
}

function parseFallback(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  if (!normalized || normalized === "local" || normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "disabled" || normalized === "false" || normalized === "0" || normalized === "none") {
    return false;
  }

  throw new Error(
    `Unsupported ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_FALLBACK: ${value}. Use "local" or "disabled".`,
  );
}

function normalizeKeyPrefix(prefix: string): string {
  return prefix.replace(/:+$/gu, "") || DEFAULT_KEY_PREFIX;
}

function expiresAtFromNow(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1_000).toISOString();
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

function warnRedisFallback(reason: unknown): void {
  if (warnedAboutRedisFallback) {
    return;
  }

  const message = reason instanceof Error ? reason.message : String(reason);
  process.emitWarning(`Attack KB recommendation response cache falling back to local memory: ${message}`, {
    code: "ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_FALLBACK",
  });
  warnedAboutRedisFallback = true;
}

function normalizeCacheInput(body: AttackKbCachedRecommendationRequestBody): unknown {
  const { requestId: _requestId, ...cacheRelevantOptions } = body.options ?? {};

  return {
    profile: body.profile ?? {},
    options: cacheRelevantOptions,
  };
}

export function buildAttackKbRecommendationResponseCacheKey(
  body: AttackKbCachedRecommendationRequestBody,
  keyPrefix = DEFAULT_KEY_PREFIX,
): AttackKbRecommendationResponseCacheKey {
  const input = normalizeCacheInput(body);
  const inputHash = sha256(canonicalJson(input));
  const payloadHash = sha256(
    canonicalJson({
      version: CACHE_KEY_VERSION,
      input,
    }),
  );
  const prefix = normalizeKeyPrefix(keyPrefix);

  return {
    key: `${prefix}:v${CACHE_KEY_VERSION}:${payloadHash}`,
    inputHash,
  };
}

function parseStoredEntry(serialized: string): StoredAttackKbRecommendationResponse | undefined {
  try {
    const parsed = JSON.parse(serialized) as Partial<StoredAttackKbRecommendationResponse>;

    if (
      parsed.version !== CACHE_ENTRY_VERSION ||
      typeof parsed.inputHash !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !parsed.response ||
      typeof parsed.response !== "object"
    ) {
      return undefined;
    }

    return parsed as StoredAttackKbRecommendationResponse;
  } catch {
    return undefined;
  }
}

function materializeStoredHit(
  provider: AttackKbRecommendationResponseCacheProvider,
  key: AttackKbRecommendationResponseCacheKey,
  serialized: string,
): AttackKbRecommendationResponseCacheHit | undefined {
  const entry = parseStoredEntry(serialized);

  if (!entry || entry.inputHash !== key.inputHash || isExpired(entry.expiresAt)) {
    return undefined;
  }

  return {
    ...key,
    ...entry,
    provider,
  };
}

function serializeStoredEntry(entry: StoredAttackKbRecommendationResponse): string {
  const serialized = JSON.stringify(entry);

  if (typeof serialized !== "string") {
    throw new Error("Attack KB recommendation response cache values must be JSON-serializable.");
  }

  return serialized;
}

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

function cacheMetadata(
  hit: boolean,
  result: AttackKbRecommendationResponseCacheKey & {
    provider: AttackKbRecommendationResponseCacheProvider;
    createdAt?: string;
    expiresAt?: string;
    response?: AttackKbResponse;
  },
  timings?: AttackKbRecommendationResponseCacheMetadata["timings"],
): AttackKbRecommendationResponseCacheMetadata {
  return {
    provider: result.provider,
    hit,
    key: result.key,
    inputHash: result.inputHash,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    servedAt: new Date().toISOString(),
    cachedRequestId: result.response?.requestId,
    timings,
    requestFingerprintExcludes: ["options.requestId"],
  };
}

function withCacheMetadata(
  body: AttackKbCachedRecommendationRequestBody,
  response: AttackKbResponse,
  metadata: AttackKbRecommendationResponseCacheMetadata,
): AttackKbCachedRecommendationResponse {
  return {
    ...response,
    requestId: body.options?.requestId ?? response.requestId,
    serverRecommendationCache: metadata,
  };
}

export function getAttackKbRecommendationResponseCacheConfig(): AttackKbRecommendationResponseCacheConfig {
  const redisConnection = readAttackKbRedisConnectionConfig();

  return {
    provider: parseProvider(env("ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE"), Boolean(redisConnection.url)),
    ttlSeconds: parsePositiveIntegerEnv(
      "ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_TTL_SECONDS",
      DEFAULT_TTL_SECONDS,
    ),
    redis: {
      url: env("ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_URL") || redisConnection.url,
      keyPrefix: normalizeKeyPrefix(env("ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_KEY_PREFIX") || DEFAULT_KEY_PREFIX),
      fallbackToLocal: parseFallback(env("ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_FALLBACK")),
    },
  };
}

export type AttackKbRecommendationResponseCache = {
  provider: AttackKbRecommendationResponseCacheProvider;
  get(body: AttackKbCachedRecommendationRequestBody): Promise<AttackKbRecommendationResponseCacheHit | undefined>;
  set(
    body: AttackKbCachedRecommendationRequestBody,
    response: AttackKbResponse,
  ): Promise<AttackKbRecommendationResponseCacheSetResult>;
  close?(): Promise<void>;
};

export function createLocalAttackKbRecommendationResponseCache(
  config: Pick<AttackKbRecommendationResponseCacheConfig, "ttlSeconds"> & { keyPrefix?: string },
): AttackKbRecommendationResponseCache {
  const entries = new Map<string, string>();

  return {
    provider: "local",
    async get(body) {
      const key = buildAttackKbRecommendationResponseCacheKey(body, config.keyPrefix);
      const serialized = entries.get(key.key);

      if (!serialized) {
        return undefined;
      }

      const hit = materializeStoredHit("local", key, serialized);
      if (!hit) {
        entries.delete(key.key);
      }

      return hit;
    },
    async set(body, response) {
      const key = buildAttackKbRecommendationResponseCacheKey(body, config.keyPrefix);
      const createdAt = new Date().toISOString();
      const entry: StoredAttackKbRecommendationResponse = {
        version: CACHE_ENTRY_VERSION,
        inputHash: key.inputHash,
        response,
        createdAt,
        expiresAt: expiresAtFromNow(config.ttlSeconds),
      };
      entries.set(key.key, serializeStoredEntry(entry));

      return {
        ...key,
        provider: "local",
        createdAt,
        expiresAt: entry.expiresAt,
      };
    },
    async close() {
      entries.clear();
    },
  };
}

export function createRedisAttackKbRecommendationResponseCache(
  config: AttackKbRecommendationResponseCacheConfig,
  fallback: AttackKbRecommendationResponseCache = createLocalAttackKbRecommendationResponseCache({
    ttlSeconds: config.ttlSeconds,
    keyPrefix: config.redis.keyPrefix,
  }),
): AttackKbRecommendationResponseCache {
  let client: AttackKbRedisClient | undefined;

  async function getClient(): Promise<AttackKbRedisClient> {
    if (!config.redis.url) {
      throw new Error(
        "Attack KB recommendation response Redis cache is enabled but no Redis URL is set. Set REDIS_URL or ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_URL.",
      );
    }

    client ??= createAttackKbRedisClient({ url: config.redis.url }, { onError: () => undefined });
    if (!client.isOpen) {
      await client.connect();
    }
    return client;
  }

  async function useFallbackOrMiss<T>(reason: unknown, operation: (fallbackCache: AttackKbRecommendationResponseCache) => Promise<T>): Promise<T | undefined> {
    if (config.redis.fallbackToLocal) {
      warnRedisFallback(reason);
      return operation(fallback);
    }

    return undefined;
  }

  return {
    provider: "redis",
    async get(body) {
      const key = buildAttackKbRecommendationResponseCacheKey(body, config.redis.keyPrefix);

      try {
        const redis = await getClient();
        const serialized = await redis.get(key.key);

        if (!serialized) {
          return undefined;
        }

        return materializeStoredHit("redis", key, serialized);
      } catch (error) {
        return useFallbackOrMiss(error, (fallbackCache) => fallbackCache.get(body));
      }
    },
    async set(body, response) {
      const key = buildAttackKbRecommendationResponseCacheKey(body, config.redis.keyPrefix);
      const createdAt = new Date().toISOString();
      const entry: StoredAttackKbRecommendationResponse = {
        version: CACHE_ENTRY_VERSION,
        inputHash: key.inputHash,
        response,
        createdAt,
        expiresAt: expiresAtFromNow(config.ttlSeconds),
      };

      try {
        const redis = await getClient();
        await redis.sendCommand(["SET", key.key, serializeStoredEntry(entry), "EX", String(config.ttlSeconds)]);

        return {
          ...key,
          provider: "redis",
          createdAt,
          expiresAt: entry.expiresAt,
        };
      } catch (error) {
        const fallbackResult = await useFallbackOrMiss(error, (fallbackCache) => fallbackCache.set(body, response));
        if (fallbackResult) {
          return fallbackResult;
        }

        return {
          ...key,
          provider: "redis",
          createdAt,
          expiresAt: entry.expiresAt,
        };
      }
    },
    async close() {
      await fallback.close?.();
      if (client?.isOpen) {
        await client.close();
      }
    },
  };
}

export function createNoopAttackKbRecommendationResponseCache(
  config: Pick<AttackKbRecommendationResponseCacheConfig, "ttlSeconds"> & { keyPrefix?: string },
): AttackKbRecommendationResponseCache {
  return {
    provider: "disabled",
    async get() {
      return undefined;
    },
    async set(body) {
      return {
        ...buildAttackKbRecommendationResponseCacheKey(body, config.keyPrefix),
        provider: "disabled",
        createdAt: new Date().toISOString(),
        expiresAt: expiresAtFromNow(config.ttlSeconds),
      };
    },
  };
}

export function createAttackKbRecommendationResponseCache(
  config: AttackKbRecommendationResponseCacheConfig = getAttackKbRecommendationResponseCacheConfig(),
): AttackKbRecommendationResponseCache {
  if (config.provider === "disabled") {
    return createNoopAttackKbRecommendationResponseCache({
      ttlSeconds: config.ttlSeconds,
      keyPrefix: config.redis.keyPrefix,
    });
  }

  if (config.provider === "local") {
    return createLocalAttackKbRecommendationResponseCache({
      ttlSeconds: config.ttlSeconds,
      keyPrefix: config.redis.keyPrefix,
    });
  }

  return createRedisAttackKbRecommendationResponseCache(config);
}

export function getDefaultAttackKbRecommendationResponseCache(): AttackKbRecommendationResponseCache {
  defaultCache ??= createAttackKbRecommendationResponseCache();
  return defaultCache;
}

export function resetDefaultAttackKbRecommendationResponseCacheForTests(): void {
  defaultCache = undefined;
  warnedAboutRedisFallback = false;
}

export async function getOrCreateCachedAttackKbRecommendationResponse(
  body: AttackKbCachedRecommendationRequestBody,
  loader: () => Promise<AttackKbResponse>,
  cache: AttackKbRecommendationResponseCache = getDefaultAttackKbRecommendationResponseCache(),
): Promise<AttackKbCachedRecommendationResponse> {
  const totalStart = performance.now();
  const lookupStart = performance.now();
  const hit = await cache.get(body);
  const cacheLookupMs = elapsedMs(lookupStart);
  if (hit) {
    return withCacheMetadata(body, hit.response, cacheMetadata(true, hit, {
      cacheLookupMs,
      totalMs: elapsedMs(totalStart),
    }));
  }

  const loaderStart = performance.now();
  const response = await loader();
  const loaderMs = elapsedMs(loaderStart);
  const setStart = performance.now();
  const setResult = await cache.set(body, response);
  const cacheSetMs = elapsedMs(setStart);
  return withCacheMetadata(body, response, cacheMetadata(false, setResult, {
    cacheLookupMs,
    loaderMs,
    cacheSetMs,
    totalMs: elapsedMs(totalStart),
  }));
}
