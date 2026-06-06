import "dotenv/config";

import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

import { getAttackKbStorageConfig } from "../storage/index.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off", ""]);

const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_TIMEOUT_MS = 2_500;

type RedisUrlSummary = {
  configured: boolean;
  valid: boolean;
  scheme?: "redis" | "rediss";
  host?: string;
  port?: number;
  database?: string;
  tls: "enabled_by_rediss_scheme" | "not_enabled_by_scheme" | "unknown";
  username: "set" | "missing";
  password: "set" | "missing";
  sanitizedEndpoint?: string;
  issue?: string;
};

type RedisReadiness = {
  connectRequested: boolean;
  status: "not_checked" | "ok" | "missing_url" | "failed";
  timeoutMs: number;
  checkedAt: string;
  detail: string;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function booleanEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`Unsupported boolean env ${name}=${raw}. Use true/false or 1/0.`);
}

function integerEnv(name: string, defaultValue: number): number {
  const raw = env(name);
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unsupported integer env ${name}=${raw}. Use a positive number.`);
  }

  return parsed;
}

function redisDatabase(pathname: string): string | undefined {
  const value = pathname.replace(/^\//, "").trim();
  return value || undefined;
}

function summarizeRedisUrl(rawUrl: string | undefined): RedisUrlSummary {
  if (!rawUrl) {
    return {
      configured: false,
      valid: false,
      tls: "unknown",
      username: "missing",
      password: "missing",
      issue: "ATTACK_KB_REDIS_IRIS_URL is not set.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      configured: true,
      valid: false,
      tls: "unknown",
      username: "missing",
      password: "missing",
      issue: "ATTACK_KB_REDIS_IRIS_URL is not a valid URL.",
    };
  }

  const scheme = parsed.protocol.replace(":", "");
  const username = parsed.username ? "set" : "missing";
  const password = parsed.password ? "set" : "missing";

  if (scheme !== "redis" && scheme !== "rediss") {
    return {
      configured: true,
      valid: false,
      tls: "unknown",
      username,
      password,
      issue: `Unsupported Redis URL scheme "${scheme}". Use redis:// or rediss://.`,
    };
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_REDIS_PORT;
  const database = redisDatabase(parsed.pathname) || "0";

  return {
    configured: true,
    valid: true,
    scheme,
    host: parsed.hostname,
    port,
    database,
    tls: scheme === "rediss" ? "enabled_by_rediss_scheme" : "not_enabled_by_scheme",
    username,
    password,
    sanitizedEndpoint: `${scheme}://${parsed.hostname}:${port}/${database}`,
  };
}

function respCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;
}

function sanitizeDiagnostic(text: string): string {
  return text.replace(/redis(s)?:\/\/\S+/gi, "[redacted-redis-url]").trim();
}

function firstRedisError(buffer: string): string | undefined {
  return buffer
    .split("\r\n")
    .find((line) => line.startsWith("-"))
    ?.slice(1)
    .trim();
}

async function pingRedis(rawUrl: string, timeoutMs: number): Promise<RedisReadiness> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      connectRequested: true,
      status: "failed",
      timeoutMs,
      checkedAt: new Date().toISOString(),
      detail: "ATTACK_KB_REDIS_IRIS_URL is not a valid URL.",
    };
  }

  const scheme = parsed.protocol;
  if (scheme !== "redis:" && scheme !== "rediss:") {
    return {
      connectRequested: true,
      status: "failed",
      timeoutMs,
      checkedAt: new Date().toISOString(),
      detail: "Unsupported Redis URL scheme. Use redis:// or rediss://.",
    };
  }

  const host = parsed.hostname;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_REDIS_PORT;
  const database = redisDatabase(parsed.pathname);
  const username = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");

  const commands: string[] = [];
  if (password) {
    commands.push(username ? respCommand(["AUTH", username, password]) : respCommand(["AUTH", password]));
  }
  if (database && database !== "0") {
    commands.push(respCommand(["SELECT", database]));
  }
  commands.push(respCommand(["PING"]));

  return new Promise<RedisReadiness>((resolve) => {
    let socket: Socket | undefined;
    let done = false;
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;

    function finish(status: RedisReadiness["status"], detail: string): void {
      if (done) {
        return;
      }
      done = true;
      if (timer) {
        clearTimeout(timer);
      }
      socket?.destroy();
      resolve({
        connectRequested: true,
        status,
        timeoutMs,
        checkedAt: new Date().toISOString(),
        detail: sanitizeDiagnostic(detail),
      });
    }

    function onReady(): void {
      socket?.write(commands.join(""));
    }

    timer = setTimeout(() => {
      finish("failed", `Timed out after ${timeoutMs}ms waiting for Redis PING.`);
    }, timeoutMs);

    if (scheme === "rediss:") {
      socket = connectTls({ host, port, servername: host }, onReady);
    } else {
      socket = connectNet({ host, port }, onReady);
    }

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const redisError = firstRedisError(buffer);
      if (redisError) {
        finish("failed", `Redis returned an error during AUTH/SELECT/PING: ${redisError}`);
        return;
      }
      if (buffer.includes("+PONG\r\n")) {
        finish("ok", "Redis AUTH/SELECT/PING readiness check succeeded.");
      }
    });

    socket.on("timeout", () => {
      finish("failed", `Timed out after ${timeoutMs}ms waiting for Redis PING.`);
    });

    socket.on("error", (error: Error) => {
      finish("failed", error.message);
    });

    socket.on("end", () => {
      if (!done) {
        finish("failed", "Redis connection ended before PING completed.");
      }
    });
  });
}

async function readiness(rawUrl: string | undefined): Promise<RedisReadiness> {
  const connectRequested = booleanEnv("ATTACK_KB_REDIS_HEALTH_CONNECT", false);
  const timeoutMs = integerEnv("ATTACK_KB_REDIS_HEALTH_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

  if (!connectRequested) {
    return {
      connectRequested: false,
      status: "not_checked",
      timeoutMs,
      checkedAt: new Date().toISOString(),
      detail: "Report-only mode. Set ATTACK_KB_REDIS_HEALTH_CONNECT=1 to run AUTH/SELECT/PING.",
    };
  }

  if (!rawUrl) {
    return {
      connectRequested: true,
      status: "missing_url",
      timeoutMs,
      checkedAt: new Date().toISOString(),
      detail: "Cannot check Redis reachability because ATTACK_KB_REDIS_IRIS_URL is not set.",
    };
  }

  return pingRedis(rawUrl, timeoutMs);
}

const storageConfig = getAttackKbStorageConfig();
const redisUrl = env("ATTACK_KB_REDIS_IRIS_URL");
const keyPrefix = env("ATTACK_KB_REDIS_KEY_PREFIX") || storageConfig.redisIris.namespace;
const eventsStream = env("ATTACK_KB_REDIS_EVENTS_STREAM") || `${keyPrefix}:events`;
const curationStream = env("ATTACK_KB_REDIS_CURATION_STREAM") || `${keyPrefix}:curation:events`;
const connectReadiness = await readiness(redisUrl);

const report = {
  generatedAt: new Date().toISOString(),
  purpose: "sanitized Attack KB Redis config/readiness report",
  storage: {
    adapter: storageConfig.provider,
    redisIris: {
      url: summarizeRedisUrl(redisUrl),
      indexName: storageConfig.redisIris.indexName,
      namespace: storageConfig.redisIris.namespace,
      fallbackToLocal: storageConfig.redisIris.fallbackToLocal,
    },
  },
  intendedRedisNames: {
    keyPrefix,
    objectKeyPattern: `${keyPrefix}:object:<objectType>:<id>`,
    sourceArtifactKeyPattern: `${keyPrefix}:object:source_artifact:<id>`,
    ingestedDataItemKeyPattern: `${keyPrefix}:object:ingested_data_item:<id>`,
    curationCandidateKeyPattern: `${keyPrefix}:object:curation_candidate:<id>`,
    searchIndex: storageConfig.redisIris.indexName,
    eventsStream,
    curationStream,
  },
  readiness: connectReadiness,
  securityGuidance: {
    subagentCredentials: "Do not pass raw Redis admin credentials to Attack KB sandbox subagents.",
    appCredential: "Use a scoped ACL user for attack-kb:* keys/indexes/streams; reserve admin users for provisioning only.",
    traceSanitization: "Reports should show set/missing and sanitized endpoints only, never raw ATTACK_KB_REDIS_IRIS_URL.",
  },
  observabilityCommandsForFinalIntegration: [
    "INFO server",
    "INFO memory",
    "INFO stats",
    "INFO commandstats",
    "SLOWLOG GET 20",
    "MEMORY DOCTOR",
    `FT.INFO ${storageConfig.redisIris.indexName}`,
    `FT.PROFILE ${storageConfig.redisIris.indexName} SEARCH QUERY \"*\" LIMIT 0 5`,
  ],
  envVars: {
    existingStorage: [
      "ATTACK_KB_STORAGE_ADAPTER",
      "ATTACK_KB_LOCAL_STORAGE_PATH",
      "ATTACK_KB_REDIS_IRIS_URL",
      "ATTACK_KB_REDIS_IRIS_INDEX",
      "ATTACK_KB_REDIS_IRIS_NAMESPACE",
      "ATTACK_KB_REDIS_IRIS_FALLBACK",
    ],
    reportingOnly: [
      "ATTACK_KB_REDIS_KEY_PREFIX",
      "ATTACK_KB_REDIS_EVENTS_STREAM",
      "ATTACK_KB_REDIS_CURATION_STREAM",
      "ATTACK_KB_REDIS_HEALTH_CONNECT",
      "ATTACK_KB_REDIS_HEALTH_TIMEOUT_MS",
    ],
  },
  openIntegration: {
    redisClientIssue: "#22 concrete Redis client should consume these env vars/logical names and replace the redis-iris stub behind AttackKbStorageAdapter.",
    currentBehavior: "This command does not instantiate the Redis storage adapter and does not require Redis reachability unless ATTACK_KB_REDIS_HEALTH_CONNECT=1.",
  },
};

console.log(JSON.stringify(report, null, 2));

if (connectReadiness.status === "failed" || connectReadiness.status === "missing_url") {
  process.exitCode = 1;
}
