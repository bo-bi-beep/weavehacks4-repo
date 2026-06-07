import type { AttackKbStorageQuery } from "../storage/types.js";
import type { AttackKbRedisClient } from "./client.js";

export type AttackKbRedisQueryIndexField = {
  path: string;
  alias: string;
  kind: "TAG" | "TEXT" | "NUMERIC";
  sortable?: boolean;
  weight?: number;
};

export type AttackKbRedisQueryIndexConfig = {
  indexName: string;
  objectKeyPrefix: string;
};

export type AttackKbRedisQueryEngineState = AttackKbRedisQueryIndexConfig & {
  available: boolean;
  schema: readonly AttackKbRedisQueryIndexField[];
  status: "created" | "already_exists" | "unavailable" | "disabled";
  reason?: string;
};

export type AttackKbRedisSearchResult = {
  total: number;
  ids: string[];
};

export const ATTACK_KB_REDIS_OBJECT_INDEX_SCHEMA = [
  { path: "$.objectType", alias: "objectType", kind: "TAG" },
  { path: "$.domain", alias: "domain", kind: "TAG" },
  { path: "$.tags[*]", alias: "tags", kind: "TAG" },
  { path: "$.sourceRefs[*]", alias: "sourceRefs", kind: "TAG" },
  { path: "$.title", alias: "title", kind: "TEXT", weight: 5 },
  { path: "$.description", alias: "description", kind: "TEXT", weight: 2 },
  { path: "$.payload.content", alias: "content", kind: "TEXT" },
  { path: "$.payload.description", alias: "payloadDescription", kind: "TEXT" },
  { path: "$.payload.template", alias: "template", kind: "TEXT" },
  { path: "$.payload.code", alias: "code", kind: "TEXT" },
  { path: "$.updatedAt", alias: "updatedAt", kind: "TAG", sortable: true },
  { path: "$.version", alias: "version", kind: "NUMERIC", sortable: true },
] as const satisfies readonly AttackKbRedisQueryIndexField[];

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/rediss?:\/\/\S+/gi, "<redacted Redis URL>");
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("index already exists") || message.includes("index name is already busy");
}

export function isAttackKbRedisQueryEngineUnavailableError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return (
    (message.includes("unknown command") && message.includes("ft.")) ||
    message.includes("unknown index name") ||
    message.includes("no such index") ||
    message.includes("index not found") ||
    message.includes("no index") ||
    (message.includes("noperm") && message.includes("ft.")) ||
    (message.includes("module") && (message.includes("search") || message.includes("redisearch")))
  );
}

function schemaCommandParts(schema: readonly AttackKbRedisQueryIndexField[]): string[] {
  const parts: string[] = [];

  for (const field of schema) {
    parts.push(field.path, "AS", field.alias, field.kind);

    if (field.kind === "TEXT" && typeof field.weight === "number") {
      parts.push("WEIGHT", String(field.weight));
    }

    if (field.sortable) {
      parts.push("SORTABLE");
    }
  }

  return parts;
}

export function buildAttackKbObjectIndexCreateCommand(
  config: AttackKbRedisQueryIndexConfig,
): string[] {
  return [
    "FT.CREATE",
    config.indexName,
    "ON",
    "JSON",
    "PREFIX",
    "1",
    config.objectKeyPrefix,
    "SCHEMA",
    ...schemaCommandParts(ATTACK_KB_REDIS_OBJECT_INDEX_SCHEMA),
  ];
}

export async function ensureAttackKbObjectSearchIndex(
  client: AttackKbRedisClient,
  config: AttackKbRedisQueryIndexConfig,
): Promise<AttackKbRedisQueryEngineState> {
  try {
    await client.sendCommand(buildAttackKbObjectIndexCreateCommand(config));
    return {
      ...config,
      available: true,
      schema: ATTACK_KB_REDIS_OBJECT_INDEX_SCHEMA,
      status: "created",
    };
  } catch (error) {
    if (isIndexAlreadyExistsError(error)) {
      return {
        ...config,
        available: true,
        schema: ATTACK_KB_REDIS_OBJECT_INDEX_SCHEMA,
        status: "already_exists",
      };
    }

    return {
      ...config,
      available: false,
      schema: ATTACK_KB_REDIS_OBJECT_INDEX_SCHEMA,
      status: "unavailable",
      reason: errorMessage(error),
    };
  }
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (typeof limit !== "number") {
    return undefined;
  }

  if (!Number.isFinite(limit)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(limit));
}

export function shouldUseAttackKbRedisQueryEngine(query: AttackKbStorageQuery): boolean {
  if (Array.isArray(query.ids)) {
    return false;
  }

  return Boolean(query.objectType || query.domain || query.text || typeof query.limit === "number");
}

const REDIS_SEARCH_SPECIAL_CHARS = /([,.<>{}\[\]"':;!@#$%^&*\-+=~\/()|])/g;

function escapeRedisSearchTagValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(REDIS_SEARCH_SPECIAL_CHARS, "\\$1")
    .replace(/\s/g, "\\ ");
}

function escapeRedisSearchTextTerm(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(REDIS_SEARCH_SPECIAL_CHARS, "\\$1");
}

function buildTextQuery(text: string | undefined): string | undefined {
  const terms = text
    ?.trim()
    .split(/\s+/)
    .map((term) => escapeRedisSearchTextTerm(term))
    .filter((term) => term.length > 0);

  if (!terms || terms.length === 0) {
    return undefined;
  }

  return terms.join(" ");
}

export function buildAttackKbRedisSearchQuery(query: AttackKbStorageQuery): string {
  const clauses: string[] = [];

  if (query.objectType) {
    clauses.push(`@objectType:{${escapeRedisSearchTagValue(query.objectType)}}`);
  }

  if (query.domain) {
    clauses.push(`@domain:{${escapeRedisSearchTagValue(query.domain)}}`);
  }

  const textQuery = buildTextQuery(query.text);
  if (textQuery) {
    clauses.push(textQuery);
  }

  return clauses.length > 0 ? clauses.join(" ") : "*";
}

function redisSearchTotal(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function redisBulkString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return undefined;
}

function parseSearchReply(reply: unknown, objectKeyPrefix: string): AttackKbRedisSearchResult {
  if (Array.isArray(reply)) {
    const total = redisSearchTotal(reply[0]);
    const ids = reply
      .slice(1)
      .map(redisBulkString)
      .filter((key): key is string => Boolean(key?.startsWith(objectKeyPrefix)))
      .map((key) => key.slice(objectKeyPrefix.length));

    return { total, ids };
  }

  if (reply && typeof reply === "object") {
    const response = reply as {
      total_results?: unknown;
      totalResults?: unknown;
      results?: Array<{ id?: unknown }>;
    };
    const ids = (response.results ?? [])
      .map((result) => redisBulkString(result.id))
      .filter((key): key is string => Boolean(key?.startsWith(objectKeyPrefix)))
      .map((key) => key.slice(objectKeyPrefix.length));

    return {
      total: redisSearchTotal(response.total_results ?? response.totalResults ?? ids.length),
      ids,
    };
  }

  throw new Error(`Unexpected FT.SEARCH reply: ${typeof reply}`);
}

async function searchOnce(
  client: AttackKbRedisClient,
  state: AttackKbRedisQueryEngineState,
  query: string,
  limit: number,
): Promise<AttackKbRedisSearchResult> {
  const reply = await client.sendCommand<unknown[]>([
    "FT.SEARCH",
    state.indexName,
    query,
    "NOCONTENT",
    "LIMIT",
    "0",
    String(limit),
    "DIALECT",
    "2",
  ]);

  return parseSearchReply(reply, state.objectKeyPrefix);
}

export async function searchAttackKbObjectIds(
  client: AttackKbRedisClient,
  state: AttackKbRedisQueryEngineState,
  query: AttackKbStorageQuery,
): Promise<AttackKbRedisSearchResult> {
  if (!state.available) {
    throw new Error(`Attack KB Redis Query Engine is unavailable: ${state.reason ?? "disabled"}`);
  }

  const redisQuery = buildAttackKbRedisSearchQuery(query);
  const limit = normalizeLimit(query.limit);

  if (limit === 0) {
    return { total: 0, ids: [] };
  }

  if (typeof limit === "number") {
    return searchOnce(client, state, redisQuery, limit);
  }

  const countOnly = await searchOnce(client, state, redisQuery, 0);
  if (countOnly.total <= 0) {
    return countOnly;
  }

  return searchOnce(client, state, redisQuery, countOnly.total);
}
