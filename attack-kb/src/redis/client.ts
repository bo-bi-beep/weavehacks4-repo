import { createClient } from "redis";

export type AttackKbRedisClient = ReturnType<typeof createClient>;

export type AttackKbRedisUrlSource = "ATTACK_KB_REDIS_IRIS_URL" | "REDIS_URL";

export type AttackKbRedisConnectionConfig = {
  url?: string;
  urlSource?: AttackKbRedisUrlSource;
};

function env(name: AttackKbRedisUrlSource, source: NodeJS.ProcessEnv): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

export function readAttackKbRedisConnectionConfig(
  source: NodeJS.ProcessEnv = process.env,
): AttackKbRedisConnectionConfig {
  const legacyUrl = env("ATTACK_KB_REDIS_IRIS_URL", source);
  if (legacyUrl) {
    return { url: legacyUrl, urlSource: "ATTACK_KB_REDIS_IRIS_URL" };
  }

  const redisUrl = env("REDIS_URL", source);
  if (redisUrl) {
    return { url: redisUrl, urlSource: "REDIS_URL" };
  }

  return {};
}

export function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = "***";
    }
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "<invalid Redis URL>";
  }
}

export function createAttackKbRedisClient(
  config: AttackKbRedisConnectionConfig,
  options: { onError?: (error: Error) => void } = {},
): AttackKbRedisClient {
  if (!config.url) {
    throw new Error("Missing Redis URL. Set ATTACK_KB_REDIS_IRIS_URL or REDIS_URL.");
  }

  const client = createClient({ url: config.url });
  client.on("error", options.onError ?? (() => undefined));
  return client;
}
