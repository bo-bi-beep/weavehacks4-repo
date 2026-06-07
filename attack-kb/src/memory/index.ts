import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { URL } from "node:url";

import { readAttackKbRedisConnectionConfig } from "../redis/client.js";
import type {
  AttackKbMemoryAdapter,
  AttackKbMemoryNamespace,
  AttackKbMemoryRecord,
  AttackKbMemoryRecordInput,
  AttackKbMemorySearchQuery,
} from "../types.js";

export { ATTACK_KB_MEMORY_NAMESPACES } from "../types.js";
export type {
  AttackKbMemoryAdapter,
  AttackKbMemoryNamespace,
  AttackKbMemoryRecord,
  AttackKbMemoryRecordInput,
  AttackKbMemorySearchQuery,
} from "../types.js";

export const ATTACK_KB_MEMORY_ADAPTERS = ["auto", "local", "redis"] as const;
export type AttackKbMemoryProvider = (typeof ATTACK_KB_MEMORY_ADAPTERS)[number];

export type AttackKbMemoryConfig = {
  provider: AttackKbMemoryProvider;
  redis: {
    url?: string;
    keyPrefix: string;
    fallbackToLocal: boolean;
    timeoutMs: number;
  };
};

export type AttackKbMemoryOperationOptions = {
  adapter?: AttackKbMemoryAdapter;
};

type RedisCommand = (string | number)[];
type RedisValue = string | number | null | RedisValue[];

type RedisConnectionConfig = {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
  database?: number;
  timeoutMs: number;
};

const DEFAULT_MEMORY_SAFETY_BOUNDARY =
  "Attack KB memory stores synthetic defensive evaluation metadata only. Attack KB does not contact the Agent Under Test or execute attacks.";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseProvider(value: string | undefined): AttackKbMemoryProvider {
  const provider = value?.toLowerCase() || "auto";

  if (!ATTACK_KB_MEMORY_ADAPTERS.includes(provider as AttackKbMemoryProvider)) {
    throw new Error(
      `Unsupported ATTACK_KB_MEMORY_ADAPTER: ${provider}. Supported values: ${ATTACK_KB_MEMORY_ADAPTERS.join(", ")}`,
    );
  }

  return provider as AttackKbMemoryProvider;
}

function parseFallback(value: string | undefined): boolean {
  const normalized = value?.toLowerCase();

  if (!normalized || normalized === "local" || normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "disabled" || normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`Unsupported ATTACK_KB_MEMORY_REDIS_FALLBACK: ${value}. Use "local" or "disabled".`);
}

function parseTimeoutMs(value: string | undefined): number {
  if (!value) {
    return 1_500;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ATTACK_KB_MEMORY_REDIS_TIMEOUT_MS: ${value}. Use a positive number.`);
  }

  return parsed;
}

function normalizeKeyPrefix(prefix: string | undefined): string {
  const normalized = (prefix || "attack-kb:memory").replace(/:+$/u, "");
  return normalized || "attack-kb:memory";
}

export function getAttackKbMemoryConfig(): AttackKbMemoryConfig {
  const redisIrisNamespace = env("ATTACK_KB_REDIS_IRIS_NAMESPACE") || "attack-kb";
  const redisConnection = readAttackKbRedisConnectionConfig();

  return {
    provider: parseProvider(env("ATTACK_KB_MEMORY_ADAPTER")),
    redis: {
      url: env("ATTACK_KB_MEMORY_REDIS_URL") || redisConnection.url,
      keyPrefix: normalizeKeyPrefix(env("ATTACK_KB_MEMORY_REDIS_PREFIX") || `${redisIrisNamespace}:memory`),
      fallbackToLocal: parseFallback(env("ATTACK_KB_MEMORY_REDIS_FALLBACK")),
      timeoutMs: parseTimeoutMs(env("ATTACK_KB_MEMORY_REDIS_TIMEOUT_MS")),
    },
  };
}

function dateScore(createdAt: string): number {
  const score = Date.parse(createdAt);
  return Number.isFinite(score) ? score : 0;
}

function createdAtIso(createdAt?: string | Date): string {
  if (createdAt instanceof Date) {
    return createdAt.toISOString();
  }

  return createdAt ?? new Date().toISOString();
}

function searchableText(record: AttackKbMemoryRecord): string {
  return [
    record.id,
    record.namespace,
    record.runId,
    record.recommendationId,
    record.summary,
    record.text,
    record.source,
    record.safetyBoundary,
    record.tags.join(" "),
    JSON.stringify(record.payload),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function normalizeRecord<TNamespace extends AttackKbMemoryNamespace>(
  namespace: TNamespace,
  input: AttackKbMemoryRecordInput<TNamespace>,
): AttackKbMemoryRecord<TNamespace> {
  const createdAt = createdAtIso(input.createdAt);
  const tags = input.tags ?? [];
  const summary = input.summary.trim();
  const text = input.text?.trim() || `${summary}\n${JSON.stringify(input.payload)}`;

  return {
    id: input.id ?? randomUUID(),
    namespace,
    runId: input.runId,
    recommendationId: input.recommendationId,
    summary,
    text,
    tags,
    createdAt,
    source: input.source,
    safetyBoundary: input.safetyBoundary ?? DEFAULT_MEMORY_SAFETY_BOUNDARY,
    payload: input.payload,
  };
}

function matchesMemoryQuery(record: AttackKbMemoryRecord, query: AttackKbMemorySearchQuery): boolean {
  if (query.namespace && record.namespace !== query.namespace) {
    return false;
  }

  if (query.runId && record.runId !== query.runId) {
    return false;
  }

  if (query.recommendationId && record.recommendationId !== query.recommendationId) {
    return false;
  }

  if (query.tags && !query.tags.every((tag) => record.tags.includes(tag))) {
    return false;
  }

  if (query.text && !searchableText(record).includes(query.text.toLowerCase())) {
    return false;
  }

  return true;
}

function sortRecent(records: AttackKbMemoryRecord[]): AttackKbMemoryRecord[] {
  return [...records].sort((left, right) => dateScore(right.createdAt) - dateScore(left.createdAt));
}

export function createLocalAttackKbMemoryAdapter(options: { name?: string } = {}): AttackKbMemoryAdapter {
  const records = new Map<string, AttackKbMemoryRecord>();

  return {
    name: options.name ?? "attack-kb-local-memory",
    backend: "local-memory",
    async recordMemory(namespace, input) {
      const record = normalizeRecord(namespace, input);
      records.set(record.id, record);
      return record;
    },
    async searchMemory(query) {
      const limit = query.limit ?? 20;
      return sortRecent([...records.values()].filter((record) => matchesMemoryQuery(record, query))).slice(0, limit);
    },
    async listRecent(namespace, limit = 20) {
      return sortRecent(
        [...records.values()].filter((record) => (namespace ? record.namespace === namespace : true)),
      ).slice(0, limit);
    },
  };
}

function encodeRedisCommand(command: RedisCommand): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${command.length}\r\n`, "utf8")];

  for (const arg of command) {
    const value = String(arg);
    const byteLength = Buffer.byteLength(value);
    parts.push(Buffer.from(`$${byteLength}\r\n${value}\r\n`, "utf8"));
  }

  return Buffer.concat(parts);
}

function parseRedisUrl(redisUrl: string, timeoutMs: number): RedisConnectionConfig {
  const parsed = new URL(redisUrl);

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("Attack KB memory Redis URL must use redis:// or rediss://.");
  }

  const databasePath = parsed.pathname.replace(/^\//u, "");
  let database: number | undefined;

  if (databasePath) {
    const parsedDatabase = Number(databasePath);
    if (!Number.isInteger(parsedDatabase) || parsedDatabase < 0) {
      throw new Error("Attack KB memory Redis URL database path must be a non-negative integer.");
    }
    database = parsedDatabase;
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : parsed.protocol === "rediss:" ? 6380 : 6379,
    tls: parsed.protocol === "rediss:",
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database,
    timeoutMs,
  };
}

function parseOneRedisValue(buffer: Buffer, offset = 0): { value: RedisValue; offset: number } | undefined {
  if (offset >= buffer.length) {
    return undefined;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset + 1);

  if (lineEnd === -1) {
    return undefined;
  }

  const line = buffer.subarray(offset + 1, lineEnd).toString("utf8");
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

    const end = nextOffset + length;
    if (buffer.length < end + 2) {
      return undefined;
    }

    return {
      value: buffer.subarray(nextOffset, end).toString("utf8"),
      offset: end + 2,
    };
  }

  if (prefix === "*") {
    const length = Number(line);
    if (length === -1) {
      return { value: null, offset: nextOffset };
    }

    const values: RedisValue[] = [];
    let cursor = nextOffset;

    for (let index = 0; index < length; index += 1) {
      const parsed = parseOneRedisValue(buffer, cursor);
      if (!parsed) {
        return undefined;
      }

      values.push(parsed.value);
      cursor = parsed.offset;
    }

    return { value: values, offset: cursor };
  }

  throw new Error(`Unsupported Redis response prefix: ${prefix}`);
}

async function runRedisCommands(redisUrl: string, timeoutMs: number, commands: RedisCommand[]): Promise<RedisValue[]> {
  const connection = parseRedisUrl(redisUrl, timeoutMs);
  const prelude: RedisCommand[] = [];

  if (connection.password || connection.username) {
    prelude.push(
      connection.username
        ? ["AUTH", connection.username, connection.password ?? ""]
        : ["AUTH", connection.password ?? ""],
    );
  }

  if (typeof connection.database === "number") {
    prelude.push(["SELECT", connection.database]);
  }

  const allCommands = [...prelude, ...commands];
  const expectedResponses = allCommands.length;

  return new Promise<RedisValue[]>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let responses: RedisValue[] = [];
    let settled = false;
    let socket: net.Socket | tls.TLSSocket;

    function finish(error?: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve(responses.slice(prelude.length));
      }
    }

    function handleData(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        while (responses.length < expectedResponses) {
          const parsed = parseOneRedisValue(buffer);
          if (!parsed) {
            break;
          }

          responses.push(parsed.value);
          buffer = buffer.subarray(parsed.offset);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (responses.length === expectedResponses) {
        finish();
      }
    }

    const requestPayload = Buffer.concat(allCommands.map(encodeRedisCommand));

    if (connection.tls) {
      socket = tls.connect({ host: connection.host, port: connection.port, servername: connection.host });
      socket.once("secureConnect", () => socket.write(requestPayload));
    } else {
      socket = net.connect({ host: connection.host, port: connection.port });
      socket.once("connect", () => socket.write(requestPayload));
    }

    socket.setNoDelay(true);
    socket.setTimeout(connection.timeoutMs, () => finish(new Error("Redis memory request timed out.")));
    socket.on("data", handleData);
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      if (!settled && responses.length < expectedResponses) {
        finish(new Error("Redis memory connection closed before all responses arrived."));
      }
    });
  });
}

function asStringArray(value: RedisValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function parseRecord(raw: string | null): AttackKbMemoryRecord | undefined {
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as AttackKbMemoryRecord;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRedisAttackKbMemoryAdapter(options: {
  redisUrl: string;
  keyPrefix: string;
  timeoutMs: number;
  fallback?: AttackKbMemoryAdapter;
  fallbackToLocal: boolean;
}): AttackKbMemoryAdapter {
  const keyPrefix = normalizeKeyPrefix(options.keyPrefix);
  let warnedAboutFallback = false;

  function recordKey(namespace: AttackKbMemoryNamespace, id: string): string {
    return `${keyPrefix}:record:${namespace}:${id}`;
  }

  function namespaceRecentKey(namespace: AttackKbMemoryNamespace): string {
    return `${keyPrefix}:recent:${namespace}`;
  }

  function allRecentKey(): string {
    return `${keyPrefix}:recent:all`;
  }

  function warnFallback(error: unknown): void {
    if (warnedAboutFallback) {
      return;
    }

    process.emitWarning(`Attack KB Redis memory unavailable; using local fallback. ${safeErrorMessage(error)}`, {
      code: "ATTACK_KB_MEMORY_REDIS_FALLBACK",
    });
    warnedAboutFallback = true;
  }

  async function runWithFallback<T>(operation: () => Promise<T>, fallbackOperation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (options.fallback && options.fallbackToLocal) {
        warnFallback(error);
        return fallbackOperation();
      }

      throw error;
    }
  }

  function memberToRecordKey(namespace: AttackKbMemoryNamespace | undefined, member: string): string | undefined {
    if (namespace) {
      return recordKey(namespace, member);
    }

    const separator = member.indexOf(":");
    if (separator === -1) {
      return undefined;
    }

    const recordNamespace = member.slice(0, separator) as AttackKbMemoryNamespace;
    const id = member.slice(separator + 1);
    return recordKey(recordNamespace, id);
  }

  async function readRecentRecords(
    namespace: AttackKbMemoryNamespace | undefined,
    limit: number,
  ): Promise<AttackKbMemoryRecord[]> {
    const zsetKey = namespace ? namespaceRecentKey(namespace) : allRecentKey();
    const [membersValue] = await runRedisCommands(options.redisUrl, options.timeoutMs, [
      ["ZREVRANGE", zsetKey, 0, Math.max(limit - 1, 0)],
    ]);
    const members = asStringArray(membersValue);
    const keys = members
      .map((member) => memberToRecordKey(namespace, member))
      .filter((key): key is string => Boolean(key));

    if (keys.length === 0) {
      return [];
    }

    const [recordsValue] = await runRedisCommands(options.redisUrl, options.timeoutMs, [["MGET", ...keys]]);
    return asStringArray(recordsValue).map(parseRecord).filter((record): record is AttackKbMemoryRecord => Boolean(record));
  }

  return {
    name: "attack-kb-redis-memory",
    backend: "redis",
    async recordMemory(namespace, input) {
      const record = normalizeRecord(namespace, input);
      const score = dateScore(record.createdAt);
      const serialized = JSON.stringify(record);

      return runWithFallback(
        async () => {
          await runRedisCommands(options.redisUrl, options.timeoutMs, [
            ["SET", recordKey(namespace, record.id), serialized],
            ["ZADD", namespaceRecentKey(namespace), score, record.id],
            ["ZADD", allRecentKey(), score, `${namespace}:${record.id}`],
          ]);
          return record;
        },
        async () =>
          options.fallback?.recordMemory(namespace, {
            ...input,
            id: record.id,
            createdAt: record.createdAt,
          }) ?? record,
      );
    },
    async searchMemory(query) {
      return runWithFallback(
        async () => {
          const scanLimit = Math.max(query.limit ?? 20, 100);
          const records = await readRecentRecords(query.namespace, scanLimit);
          return records.filter((record) => matchesMemoryQuery(record, query)).slice(0, query.limit ?? 20);
        },
        async () => options.fallback?.searchMemory(query) ?? [],
      );
    },
    async listRecent(namespace, limit = 20) {
      return runWithFallback(
        async () => readRecentRecords(namespace, limit),
        async () => options.fallback?.listRecent(namespace, limit) ?? [],
      );
    },
    async close() {
      await options.fallback?.close?.();
    },
  };
}

export function createAttackKbMemoryAdapter(
  config: AttackKbMemoryConfig = getAttackKbMemoryConfig(),
): AttackKbMemoryAdapter {
  const fallback = createLocalAttackKbMemoryAdapter({ name: "attack-kb-memory-local-fallback" });

  if (config.provider === "local") {
    return createLocalAttackKbMemoryAdapter();
  }

  if (!config.redis.url) {
    if (config.provider === "redis" && !config.redis.fallbackToLocal) {
      throw new Error("ATTACK_KB_MEMORY_ADAPTER=redis requires ATTACK_KB_MEMORY_REDIS_URL when fallback is disabled.");
    }

    return fallback;
  }

  return createRedisAttackKbMemoryAdapter({
    redisUrl: config.redis.url,
    keyPrefix: config.redis.keyPrefix,
    timeoutMs: config.redis.timeoutMs,
    fallback,
    fallbackToLocal: config.redis.fallbackToLocal,
  });
}

let defaultMemoryAdapter: AttackKbMemoryAdapter | undefined;

export function getDefaultAttackKbMemoryAdapter(): AttackKbMemoryAdapter {
  defaultMemoryAdapter ??= createAttackKbMemoryAdapter();
  return defaultMemoryAdapter;
}

export function resetDefaultAttackKbMemoryAdapterForTests(): void {
  defaultMemoryAdapter = undefined;
}

export async function recordMemory<TNamespace extends AttackKbMemoryNamespace>(
  namespace: TNamespace,
  input: AttackKbMemoryRecordInput<TNamespace>,
  options: AttackKbMemoryOperationOptions = {},
): Promise<AttackKbMemoryRecord<TNamespace>> {
  const adapter = options.adapter ?? getDefaultAttackKbMemoryAdapter();
  return adapter.recordMemory(namespace, input);
}

export async function searchMemory(
  query: AttackKbMemorySearchQuery,
  options: AttackKbMemoryOperationOptions = {},
): Promise<AttackKbMemoryRecord[]> {
  const adapter = options.adapter ?? getDefaultAttackKbMemoryAdapter();
  return adapter.searchMemory(query);
}

export async function listRecent(
  namespace?: AttackKbMemoryNamespace,
  limit?: number,
  options: AttackKbMemoryOperationOptions = {},
): Promise<AttackKbMemoryRecord[]> {
  const adapter = options.adapter ?? getDefaultAttackKbMemoryAdapter();
  return adapter.listRecent(namespace, limit);
}
