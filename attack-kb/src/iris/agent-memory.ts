import type {
  AttackKbMemoryNamespace,
  AttackKbMemoryRecord,
  AttackKbMemorySearchQuery,
} from "../types.js";

export type RedisAgentMemoryConfig = {
  apiBaseUrl?: string;
  storeId?: string;
  apiKey?: string;
  ownerId: string;
  actorId: string;
  namespace: string;
  similarityThreshold: number;
  limit: number;
  timeoutMs: number;
};

type AgentMemoryItem = Record<string, unknown>;

const RECORD_MARKER = "ATTACK_KB_MEMORY_RECORD_JSON:";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveNumber(name: string, defaultValue: number): number {
  const raw = env(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unsupported ${name}: ${raw}. Use a positive number.`);
  }

  return parsed;
}

function parsePositiveInteger(name: string, defaultValue: number): number {
  const parsed = parsePositiveNumber(name, defaultValue);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Unsupported ${name}: ${parsed}. Use a positive integer.`);
  }

  return parsed;
}

export function sanitizeAgentMemoryId(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "").trim().replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return cleaned || fallback;
}

export function getRedisAgentMemoryConfig(): RedisAgentMemoryConfig {
  return {
    apiBaseUrl: env("MEMORY_API_BASE_URL")?.replace(/\/+$/u, ""),
    storeId: env("MEMORY_STORE_ID"),
    apiKey: env("MEMORY_API_KEY"),
    ownerId: sanitizeAgentMemoryId(env("MEMORY_OWNER_ID"), "attack-kb-demo"),
    actorId: sanitizeAgentMemoryId(env("MEMORY_ACTOR_ID"), "attack-kb"),
    namespace: env("MEMORY_NAMESPACE") || "attack-kb",
    similarityThreshold: parsePositiveNumber("MEMORY_SIMILARITY_THRESHOLD", 0.7),
    limit: parsePositiveInteger("MEMORY_LIMIT", 6),
    timeoutMs: parsePositiveInteger("ATTACK_KB_AGENT_MEMORY_TIMEOUT_MS", 10_000),
  };
}

export function isRedisAgentMemoryConfigured(config: RedisAgentMemoryConfig = getRedisAgentMemoryConfig()): boolean {
  return Boolean(config.apiBaseUrl && config.storeId && config.apiKey);
}

function requireConfigured(config: RedisAgentMemoryConfig): void {
  if (!isRedisAgentMemoryConfigured(config)) {
    throw new Error(
      "Managed Redis Agent Memory is not configured. Set MEMORY_API_BASE_URL, MEMORY_STORE_ID, and MEMORY_API_KEY.",
    );
  }
}

function headers(config: RedisAgentMemoryConfig): Record<string, string> {
  const token = config.apiKey ?? "";
  return {
    Accept: "application/json",
    Authorization: token.toLowerCase().startsWith("bearer ") || token.toLowerCase().startsWith("basic ") ? token : `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function url(config: RedisAgentMemoryConfig, path: string): string {
  requireConfigured(config);
  return `${config.apiBaseUrl}/v1/stores/${encodeURIComponent(config.storeId ?? "")}${path}`;
}

async function fetchJson(config: RedisAgentMemoryConfig, path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url(config, path), {
      ...init,
      headers: {
        ...headers(config),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Agent Memory API ${response.status}: ${text.slice(0, 300)}`);
    }

    return response.headers.get("content-type")?.includes("application/json") ? response.json() : {};
  } finally {
    clearTimeout(timeout);
  }
}

function memoryText(record: AttackKbMemoryRecord): string {
  return [
    `Attack KB memory record: ${record.summary}`,
    `Namespace: ${record.namespace}`,
    `Source: ${record.source}`,
    `Run ID: ${record.runId ?? "none"}`,
    `Recommendation ID: ${record.recommendationId ?? "none"}`,
    `Tags: ${record.tags.join(", ") || "none"}`,
    `Safety boundary: ${record.safetyBoundary}`,
    record.text,
    `${RECORD_MARKER}${JSON.stringify(record)}`,
  ].join("\n");
}

function itemText(item: AgentMemoryItem): string | undefined {
  for (const key of ["text", "memory", "content", "value"]) {
    const value = item[key];
    if (typeof value === "string") {
      return value;
    }
  }

  const nested = item.memory as AgentMemoryItem | undefined;
  if (nested && typeof nested === "object") {
    return itemText(nested);
  }

  return undefined;
}

export function parseAttackKbMemoryRecordFromAgentMemoryItem(item: AgentMemoryItem): AttackKbMemoryRecord | undefined {
  const text = itemText(item);
  if (!text) {
    return undefined;
  }

  const markerIndex = text.indexOf(RECORD_MARKER);
  if (markerIndex === -1) {
    return undefined;
  }

  const serialized = text.slice(markerIndex + RECORD_MARKER.length).trim();

  try {
    const parsed = JSON.parse(serialized) as Partial<AttackKbMemoryRecord>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.namespace !== "string" ||
      typeof parsed.summary !== "string" ||
      typeof parsed.text !== "string" ||
      !Array.isArray(parsed.tags) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.safetyBoundary !== "string"
    ) {
      return undefined;
    }

    return parsed as AttackKbMemoryRecord;
  } catch {
    return undefined;
  }
}

export async function createRedisAgentMemoryRecord(
  config: RedisAgentMemoryConfig,
  record: AttackKbMemoryRecord,
): Promise<unknown> {
  return fetchJson(config, "/long-term-memory", {
    method: "POST",
    body: JSON.stringify({
      memories: [
        {
          id: record.id,
          text: memoryText(record),
          memoryType: "semantic",
          ownerId: config.ownerId,
          sessionId: record.runId,
          namespace: config.namespace,
          topics: [record.namespace, ...record.tags].filter(Boolean),
        },
      ],
    }),
  });
}

export async function searchRedisAgentMemoryRecords(
  config: RedisAgentMemoryConfig,
  query: AttackKbMemorySearchQuery,
): Promise<AttackKbMemoryRecord[]> {
  const text = query.text || query.tags?.join(" ") || query.recommendationId || query.runId || "Attack KB memory record";
  const filter: Record<string, unknown> = {
    ownerId: { eq: config.ownerId },
    namespace: { eq: config.namespace },
  };

  if (query.runId) {
    filter.sessionId = { eq: query.runId };
  }

  const payload = await fetchJson(config, "/long-term-memory/search", {
    method: "POST",
    body: JSON.stringify({
      text,
      similarityThreshold: config.similarityThreshold,
      filterOp: "all",
      limit: query.limit ?? config.limit,
      filter,
    }),
  });

  const items = extractAgentMemoryItems(payload);
  return items
    .map(parseAttackKbMemoryRecordFromAgentMemoryItem)
    .filter((record): record is AttackKbMemoryRecord => Boolean(record));
}

export async function deleteRedisAgentMemoryRecord(
  config: RedisAgentMemoryConfig,
  memoryId: string,
): Promise<unknown> {
  return fetchJson(config, "/long-term-memory", {
    method: "DELETE",
    body: JSON.stringify({ memoryIds: [memoryId] }),
  });
}

export async function addRedisAgentMemorySessionEvent(
  config: RedisAgentMemoryConfig,
  options: {
    sessionId?: string;
    role: "USER" | "ASSISTANT" | "SYSTEM";
    text: string;
    metadata?: Record<string, unknown>;
  },
): Promise<unknown> {
  return fetchJson(config, "/session-memory/events", {
    method: "POST",
    body: JSON.stringify({
      actorId: config.actorId,
      role: options.role,
      content: [{ text: options.text }],
      createdAt: new Date().toISOString(),
      sessionId: options.sessionId,
      metadata: options.metadata ?? {},
    }),
  });
}

export function extractAgentMemoryItems(payload: unknown): AgentMemoryItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const body = payload as { items?: unknown; memories?: unknown };
  const items = Array.isArray(body.items) ? body.items : Array.isArray(body.memories) ? body.memories : [];
  return items.filter((item): item is AgentMemoryItem => Boolean(item && typeof item === "object"));
}
