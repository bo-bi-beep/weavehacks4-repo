import { createHash } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import { readAttackKbRedisConnectionConfig } from "../redis/client.js";

export const ATTACK_KB_LLM_CACHE_TASK_SCOPES = [
  "source-triage",
  "curation-review",
  "recommendation-explanation",
  "eval-scorer",
] as const;

export type AttackKbLlmCacheTaskScope = (typeof ATTACK_KB_LLM_CACHE_TASK_SCOPES)[number];
export type AttackKbLlmCacheProvider = "disabled" | "local" | "redis";

export type AttackKbLlmCacheConfig = {
  provider: AttackKbLlmCacheProvider;
  ttlSeconds: number;
  redis: {
    url?: string;
    keyPrefix: string;
    fallbackToLocal: boolean;
    timeoutMs: number;
  };
};

export type AttackKbLlmCacheRequest = {
  task: AttackKbLlmCacheTaskScope;
  model: string;
  input: unknown;
};

export type AttackKbLlmCacheKey = {
  key: string;
  task: AttackKbLlmCacheTaskScope;
  model: string;
  inputHash: string;
  payloadHash: string;
  exact: true;
};

export type AttackKbLlmCacheHit<T> = AttackKbLlmCacheKey & {
  provider: AttackKbLlmCacheProvider;
  hit: true;
  value: T;
  createdAt: string;
  expiresAt: string;
};

export type AttackKbLlmCacheSetResult = AttackKbLlmCacheKey & {
  provider: AttackKbLlmCacheProvider;
  expiresAt: string;
};

export type AttackKbLlmCacheWrapResult<T> = AttackKbLlmCacheKey & {
  provider: AttackKbLlmCacheProvider;
  hit: boolean;
  value: T;
  expiresAt?: string;
};

export type AttackKbLlmCache = {
  provider: AttackKbLlmCacheProvider;
  get<T>(request: AttackKbLlmCacheRequest): Promise<AttackKbLlmCacheHit<T> | undefined>;
  set<T>(request: AttackKbLlmCacheRequest, value: T): Promise<AttackKbLlmCacheSetResult>;
  wrap<T>(
    request: AttackKbLlmCacheRequest,
    loader: () => Promise<T>,
  ): Promise<AttackKbLlmCacheWrapResult<T>>;
  close?(): Promise<void>;
};

type StoredAttackKbLlmCacheEntry = {
  version: typeof CACHE_ENTRY_VERSION;
  task: AttackKbLlmCacheTaskScope;
  model: string;
  inputHash: string;
  value: unknown;
  createdAt: string;
  expiresAt: string;
};

type RedisRespValue = string | number | null | RedisRespValue[];

type RedisParseResult = {
  value: RedisRespValue;
  offset: number;
};

const CACHE_KEY_VERSION = 1;
const CACHE_ENTRY_VERSION = 1;
const DEFAULT_CACHE_TTL_SECONDS = 86_400;
const DEFAULT_REDIS_TIMEOUT_MS = 2_000;
const DEFAULT_REDIS_KEY_PREFIX = "attack-kb:llm-cache";

let defaultCache: AttackKbLlmCache | undefined;
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

function isTaskScope(value: string): value is AttackKbLlmCacheTaskScope {
  return ATTACK_KB_LLM_CACHE_TASK_SCOPES.includes(value as AttackKbLlmCacheTaskScope);
}

function requireTaskScope(task: AttackKbLlmCacheTaskScope): AttackKbLlmCacheTaskScope {
  if (!isTaskScope(task)) {
    throw new Error(
      `Unsupported Attack KB LLM cache task scope: ${String(task)}. Supported scopes: ${ATTACK_KB_LLM_CACHE_TASK_SCOPES.join(", ")}`,
    );
  }

  return task;
}

function normalizeKeyPrefix(prefix: string): string {
  return prefix.replace(/:+$/g, "") || DEFAULT_REDIS_KEY_PREFIX;
}

function parseCacheProvider(value: string | undefined): AttackKbLlmCacheProvider {
  const normalized = value?.toLowerCase() || "disabled";

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
    `Unsupported ATTACK_KB_LLM_CACHE: ${value}. Supported values: disabled, local, redis.`,
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

function parseRedisFallback(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  if (!normalized || normalized === "local" || normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "disabled" || normalized === "false" || normalized === "0" || normalized === "none") {
    return false;
  }

  throw new Error(
    `Unsupported ATTACK_KB_REDIS_CACHE_FALLBACK: ${value}. Use "local" or "disabled".`,
  );
}

function expiresAtFromNow(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1_000).toISOString();
}

function isExpired(expiresAt: string): boolean {
  return Date.parse(expiresAt) <= Date.now();
}

function createStoredEntry<T>(
  request: AttackKbLlmCacheRequest,
  key: AttackKbLlmCacheKey,
  value: T,
  ttlSeconds: number,
): StoredAttackKbLlmCacheEntry {
  return {
    version: CACHE_ENTRY_VERSION,
    task: request.task,
    model: key.model,
    inputHash: key.inputHash,
    value,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAtFromNow(ttlSeconds),
  };
}

function serializeStoredEntry(entry: StoredAttackKbLlmCacheEntry): string {
  const serialized = JSON.stringify(entry);

  if (typeof serialized !== "string") {
    throw new Error("Attack KB LLM cache values must be JSON-serializable.");
  }

  return serialized;
}

function parseStoredEntry(serialized: string): StoredAttackKbLlmCacheEntry | undefined {
  try {
    const parsed = JSON.parse(serialized) as Partial<StoredAttackKbLlmCacheEntry>;

    if (
      parsed.version !== CACHE_ENTRY_VERSION ||
      typeof parsed.task !== "string" ||
      !isTaskScope(parsed.task) ||
      typeof parsed.model !== "string" ||
      typeof parsed.inputHash !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return undefined;
    }

    return parsed as StoredAttackKbLlmCacheEntry;
  } catch {
    return undefined;
  }
}

function entryMatchesRequest(
  entry: StoredAttackKbLlmCacheEntry,
  request: AttackKbLlmCacheRequest,
  key: AttackKbLlmCacheKey,
): boolean {
  return entry.task === request.task && entry.model === key.model && entry.inputHash === key.inputHash;
}

function materializeHit<T>(
  provider: AttackKbLlmCacheProvider,
  request: AttackKbLlmCacheRequest,
  key: AttackKbLlmCacheKey,
  serialized: string,
): AttackKbLlmCacheHit<T> | undefined {
  const entry = parseStoredEntry(serialized);

  if (!entry || !entryMatchesRequest(entry, request, key) || isExpired(entry.expiresAt)) {
    return undefined;
  }

  return {
    ...key,
    provider,
    hit: true,
    value: entry.value as T,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

async function wrapWithCache<T>(
  cache: AttackKbLlmCache,
  request: AttackKbLlmCacheRequest,
  loader: () => Promise<T>,
): Promise<AttackKbLlmCacheWrapResult<T>> {
  const hit = await cache.get<T>(request);

  if (hit) {
    return hit;
  }

  const value = await loader();
  const setResult = await cache.set(request, value);

  return {
    ...setResult,
    hit: false,
    value,
  };
}

function buildUnsupportedRedisCacheError(config: AttackKbLlmCacheConfig): Error {
  return new Error(
    [
      "Attack KB Redis LLM cache is enabled but no Redis URL is set or Redis is unavailable.",
      "Set REDIS_URL or ATTACK_KB_REDIS_CACHE_URL. Set ATTACK_KB_REDIS_CACHE_FALLBACK=local to fail open, or ATTACK_KB_LLM_CACHE=disabled to bypass the cache.",
      `keyPrefix=${config.redis.keyPrefix}`,
    ].join(" "),
  );
}

function warnRedisFallback(reason: unknown): void {
  if (warnedAboutRedisFallback) {
    return;
  }

  const message = reason instanceof Error ? reason.message : String(reason);
  process.emitWarning(`Attack KB Redis LLM cache falling back to local memory: ${message}`, {
    code: "ATTACK_KB_REDIS_CACHE_FALLBACK",
  });
  warnedAboutRedisFallback = true;
}

export function getAttackKbLlmCacheConfig(): AttackKbLlmCacheConfig {
  const redisConnection = readAttackKbRedisConnectionConfig();

  return {
    provider: parseCacheProvider(env("ATTACK_KB_LLM_CACHE")),
    ttlSeconds: parsePositiveIntegerEnv("ATTACK_KB_LLM_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS),
    redis: {
      url: env("ATTACK_KB_REDIS_CACHE_URL") || redisConnection.url,
      keyPrefix: normalizeKeyPrefix(env("ATTACK_KB_REDIS_CACHE_KEY_PREFIX") || DEFAULT_REDIS_KEY_PREFIX),
      fallbackToLocal: parseRedisFallback(env("ATTACK_KB_REDIS_CACHE_FALLBACK")),
      timeoutMs: parsePositiveIntegerEnv("ATTACK_KB_REDIS_CACHE_TIMEOUT_MS", DEFAULT_REDIS_TIMEOUT_MS),
    },
  };
}

export function buildAttackKbLlmCacheKey(
  request: AttackKbLlmCacheRequest,
  keyPrefix = DEFAULT_REDIS_KEY_PREFIX,
): AttackKbLlmCacheKey {
  const task = requireTaskScope(request.task);
  const model = request.model.trim();

  if (!model) {
    throw new Error("Attack KB LLM cache requires a non-empty model name.");
  }

  const inputHash = sha256(canonicalJson(request.input));
  const payloadHash = sha256(
    canonicalJson({
      version: CACHE_KEY_VERSION,
      task,
      model,
      input: request.input,
    }),
  );
  const modelHash = sha256(model).slice(0, 16);
  const prefix = normalizeKeyPrefix(keyPrefix);

  // The task scope is part of both the human-inspectable key path and the hashed
  // payload. A source-triage response can never satisfy a curation-review lookup,
  // even when model + input text happen to match exactly.
  return {
    key: `${prefix}:v${CACHE_KEY_VERSION}:${task}:${modelHash}:${payloadHash}`,
    task,
    model,
    inputHash,
    payloadHash,
    exact: true,
  };
}

export function createNoopAttackKbLlmCache(
  config: Pick<AttackKbLlmCacheConfig, "ttlSeconds"> & { keyPrefix?: string } = {
    ttlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  },
): AttackKbLlmCache {
  const cache: AttackKbLlmCache = {
    provider: "disabled",
    async get() {
      return undefined;
    },
    async set(request) {
      return {
        ...buildAttackKbLlmCacheKey(request, config.keyPrefix),
        provider: "disabled",
        expiresAt: expiresAtFromNow(config.ttlSeconds),
      };
    },
    async wrap(request, loader) {
      return wrapWithCache(cache, request, loader);
    },
  };

  return cache;
}

export function createLocalAttackKbLlmCache(
  config: Pick<AttackKbLlmCacheConfig, "ttlSeconds"> & { keyPrefix?: string },
): AttackKbLlmCache {
  const entries = new Map<string, string>();

  const cache: AttackKbLlmCache = {
    provider: "local",
    async get<T>(request: AttackKbLlmCacheRequest) {
      const key = buildAttackKbLlmCacheKey(request, config.keyPrefix);
      const serialized = entries.get(key.key);

      if (!serialized) {
        return undefined;
      }

      const hit = materializeHit<T>("local", request, key, serialized);

      if (!hit) {
        entries.delete(key.key);
      }

      return hit;
    },
    async set<T>(request: AttackKbLlmCacheRequest, value: T) {
      const key = buildAttackKbLlmCacheKey(request, config.keyPrefix);
      const entry = createStoredEntry(request, key, value, config.ttlSeconds);
      entries.set(key.key, serializeStoredEntry(entry));

      return {
        ...key,
        provider: "local",
        expiresAt: entry.expiresAt,
      };
    },
    async wrap<T>(request: AttackKbLlmCacheRequest, loader: () => Promise<T>) {
      return wrapWithCache(cache, request, loader);
    },
    async close() {
      entries.clear();
    },
  };

  return cache;
}

export function createRedisAttackKbLlmCache(
  config: AttackKbLlmCacheConfig,
  fallback: AttackKbLlmCache = createLocalAttackKbLlmCache({
    ttlSeconds: config.ttlSeconds,
    keyPrefix: config.redis.keyPrefix,
  }),
): AttackKbLlmCache {
  async function useFallbackOrThrow<T>(
    reason: unknown,
    operation: (fallbackCache: AttackKbLlmCache) => Promise<T>,
  ): Promise<T> {
    if (config.redis.fallbackToLocal) {
      warnRedisFallback(reason);
      return operation(fallback);
    }

    throw reason instanceof Error ? reason : buildUnsupportedRedisCacheError(config);
  }

  const cache: AttackKbLlmCache = {
    provider: "redis",
    async get<T>(request: AttackKbLlmCacheRequest) {
      if (!config.redis.url) {
        return useFallbackOrThrow(buildUnsupportedRedisCacheError(config), (fallbackCache) =>
          fallbackCache.get<T>(request),
        );
      }

      const key = buildAttackKbLlmCacheKey(request, config.redis.keyPrefix);

      try {
        const value = await executeRedisCommand(config.redis.url, ["GET", key.key], config.redis.timeoutMs);

        if (typeof value !== "string") {
          return undefined;
        }

        return materializeHit<T>("redis", request, key, value);
      } catch (error) {
        return useFallbackOrThrow(error, (fallbackCache) => fallbackCache.get<T>(request));
      }
    },
    async set<T>(request: AttackKbLlmCacheRequest, value: T) {
      if (!config.redis.url) {
        return useFallbackOrThrow(buildUnsupportedRedisCacheError(config), (fallbackCache) =>
          fallbackCache.set(request, value),
        );
      }

      const key = buildAttackKbLlmCacheKey(request, config.redis.keyPrefix);
      const entry = createStoredEntry(request, key, value, config.ttlSeconds);
      const serialized = serializeStoredEntry(entry);

      try {
        await executeRedisCommand(
          config.redis.url,
          ["SET", key.key, serialized, "EX", String(config.ttlSeconds)],
          config.redis.timeoutMs,
        );

        return {
          ...key,
          provider: "redis",
          expiresAt: entry.expiresAt,
        };
      } catch (error) {
        return useFallbackOrThrow(error, (fallbackCache) => fallbackCache.set(request, value));
      }
    },
    async wrap<T>(request: AttackKbLlmCacheRequest, loader: () => Promise<T>) {
      return wrapWithCache(cache, request, loader);
    },
    async close() {
      await fallback.close?.();
    },
  };

  return cache;
}

export function createAttackKbLlmCache(
  config: AttackKbLlmCacheConfig = getAttackKbLlmCacheConfig(),
): AttackKbLlmCache {
  if (config.provider === "disabled") {
    return createNoopAttackKbLlmCache({
      ttlSeconds: config.ttlSeconds,
      keyPrefix: config.redis.keyPrefix,
    });
  }

  if (config.provider === "local") {
    return createLocalAttackKbLlmCache({
      ttlSeconds: config.ttlSeconds,
      keyPrefix: config.redis.keyPrefix,
    });
  }

  return createRedisAttackKbLlmCache(config);
}

export function getDefaultAttackKbLlmCache(): AttackKbLlmCache {
  defaultCache ??= createAttackKbLlmCache();
  return defaultCache;
}

export function resetDefaultAttackKbLlmCacheForTests(): void {
  defaultCache = undefined;
  warnedAboutRedisFallback = false;
}

function encodeRedisCommand(args: string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`, "utf8")];

  for (const arg of args) {
    const value = Buffer.from(arg, "utf8");
    chunks.push(Buffer.from(`$${value.byteLength}\r\n`, "utf8"), value, Buffer.from("\r\n", "utf8"));
  }

  return Buffer.concat(chunks);
}

function findLineEnd(buffer: Buffer, offset: number): number {
  for (let index = offset; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      return index;
    }
  }

  return -1;
}

function parseRespValue(buffer: Buffer, offset = 0): RedisParseResult | undefined {
  if (offset >= buffer.length) {
    return undefined;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = findLineEnd(buffer, offset + 1);

  if (lineEnd === -1) {
    return undefined;
  }

  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const nextOffset = lineEnd + 2;

  if (prefix === "+") {
    return { value: line, offset: nextOffset };
  }

  if (prefix === "-") {
    throw new Error(`Redis error: ${line}`);
  }

  if (prefix === ":") {
    return { value: Number(line), offset: nextOffset };
  }

  if (prefix === "$") {
    const length = Number(line);

    if (length === -1) {
      return { value: null, offset: nextOffset };
    }

    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Invalid Redis bulk string length: ${line}`);
    }

    const valueEnd = nextOffset + length;
    const terminatorEnd = valueEnd + 2;

    if (buffer.length < terminatorEnd) {
      return undefined;
    }

    if (buffer[valueEnd] !== 13 || buffer[valueEnd + 1] !== 10) {
      throw new Error("Invalid Redis bulk string terminator.");
    }

    return {
      value: buffer.toString("utf8", nextOffset, valueEnd),
      offset: terminatorEnd,
    };
  }

  if (prefix === "*") {
    const length = Number(line);

    if (length === -1) {
      return { value: null, offset: nextOffset };
    }

    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Invalid Redis array length: ${line}`);
    }

    const values: RedisRespValue[] = [];
    let currentOffset = nextOffset;

    for (let index = 0; index < length; index += 1) {
      const parsed = parseRespValue(buffer, currentOffset);

      if (!parsed) {
        return undefined;
      }

      values.push(parsed.value);
      currentOffset = parsed.offset;
    }

    return { value: values, offset: currentOffset };
  }

  throw new Error(`Unsupported Redis RESP prefix: ${prefix}`);
}

function decodeRedisUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redisCommandsForUrl(url: URL, command: string[]): string[][] {
  const commands: string[][] = [];
  const username = decodeRedisUrlPart(url.username);
  const password = decodeRedisUrlPart(url.password);

  if (password) {
    commands.push(username ? ["AUTH", username, password] : ["AUTH", password]);
  }

  const database = url.pathname.replace(/^\/+/, "").split("/")[0];
  if (database) {
    commands.push(["SELECT", decodeRedisUrlPart(database)]);
  }

  commands.push(command);
  return commands;
}

function openRedisSocket(url: URL, timeoutMs: number): Promise<Socket | TLSSocket> {
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis cache URL protocol: ${url.protocol}. Use redis:// or rediss://.`);
  }

  const host = url.hostname || "localhost";
  const port = url.port ? Number(url.port) : 6379;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Unsupported Redis cache port: ${url.port}`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(error?: Error, socket?: Socket | TLSSocket): void {
      if (settled) {
        return;
      }

      settled = true;

      if (error) {
        reject(error);
        return;
      }

      if (!socket) {
        reject(new Error("Redis cache socket did not initialize."));
        return;
      }

      socket.off("error", onError);
      resolve(socket);
    }

    function onError(error: Error): void {
      finish(error);
    }

    let socket: Socket | TLSSocket;
    socket =
      url.protocol === "rediss:"
        ? connectTls({ host, port, servername: host }, () => finish(undefined, socket))
        : createConnection({ host, port }, () => finish(undefined, socket));

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`Redis cache connection timed out after ${timeoutMs}ms.`));
    });
    socket.once("error", onError);
  });
}

async function executeRedisCommand(
  urlString: string,
  command: string[],
  timeoutMs: number,
): Promise<RedisRespValue> {
  const url = new URL(urlString);
  const commands = redisCommandsForUrl(url, command);
  const socket = await openRedisSocket(url, timeoutMs);

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const responses: RedisRespValue[] = [];
    let settled = false;

    function cleanup(): void {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.end();
    }

    function finish(error?: Error, value?: RedisRespValue): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (error) {
        reject(error);
        return;
      }

      resolve(value ?? null);
    }

    function onError(error: Error): void {
      finish(error);
    }

    function onTimeout(): void {
      finish(new Error(`Redis cache command timed out after ${timeoutMs}ms.`));
    }

    function onData(data: Buffer): void {
      buffer = Buffer.concat([buffer, data]);

      try {
        while (responses.length < commands.length) {
          const parsed = parseRespValue(buffer);

          if (!parsed) {
            return;
          }

          responses.push(parsed.value);
          buffer = buffer.subarray(parsed.offset);
        }

        finish(undefined, responses[responses.length - 1] ?? null);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    }

    socket.setTimeout(timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.write(Buffer.concat(commands.map(encodeRedisCommand)));
  });
}
