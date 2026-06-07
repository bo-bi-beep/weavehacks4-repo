import "dotenv/config";

import { createAttackKbRedisClient, readAttackKbRedisConnectionConfig } from "../redis/client.js";
import { flushConfiguredLangCache, isLangCacheConfigured } from "../cache/index.js";

const REQUIRED_CONFIRMATION = "delete-attack-kb-data";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function scanKeys(client: ReturnType<typeof createAttackKbRedisClient>, pattern: string): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];

  do {
    const reply = await client.sendCommand<unknown>(["SCAN", cursor, "MATCH", pattern, "COUNT", "500"]);
    if (!Array.isArray(reply) || typeof reply[0] !== "string" || !Array.isArray(reply[1])) {
      throw new Error(`Unexpected SCAN reply for ${pattern}: ${JSON.stringify(reply)}`);
    }

    cursor = reply[0];
    keys.push(...reply[1].filter((item): item is string => typeof item === "string"));
  } while (cursor !== "0");

  return keys;
}

async function delBatches(client: ReturnType<typeof createAttackKbRedisClient>, keys: string[]): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < keys.length; index += 250) {
    const batch = keys.slice(index, index + 250);
    if (batch.length > 0) {
      const result = await client.sendCommand<number>(["DEL", ...batch]);
      deleted += typeof result === "number" ? result : 0;
    }
  }

  return deleted;
}

async function main(): Promise<void> {
  if (env("ATTACK_KB_CLEAR_DATA_CONFIRM") !== REQUIRED_CONFIRMATION) {
    console.error(
      `Refusing to clear data. Set ATTACK_KB_CLEAR_DATA_CONFIRM=${REQUIRED_CONFIRMATION} to delete Attack KB Redis data.`,
    );
    process.exitCode = 1;
    return;
  }

  const redisConfig = readAttackKbRedisConnectionConfig();
  if (!redisConfig.url) {
    throw new Error("Missing Redis URL. Set REDIS_URL before clearing Attack KB Redis data.");
  }

  const includeContextProjection = env("ATTACK_KB_CLEAR_CONTEXT_PROJECTIONS") !== "false";
  const includeLangCache = env("ATTACK_KB_CLEAR_LANGCACHE") !== "false";
  const patterns = ["attack-kb:*"];
  if (includeContextProjection) {
    patterns.push(
      "decision_factor:*",
      "recon_probe:*",
      "domain_scenario:*",
      "business_route:*",
      "system_pattern:*",
      "vulnerability:*",
      "attack_pattern:*",
      "source_artifact:*",
      "evidence_source:*",
      "ingested_data_item:*",
    );
  }

  const client = createAttackKbRedisClient(redisConfig);
  await client.connect();

  try {
    const deletedByPattern: Record<string, number> = {};
    for (const pattern of patterns) {
      const keys = await scanKeys(client, pattern);
      deletedByPattern[pattern] = await delBatches(client, keys);
    }

    let langCacheFlushed = false;
    if (includeLangCache && isLangCacheConfigured()) {
      await flushConfiguredLangCache().catch((error) => {
        throw new Error(`LangCache flush failed during Attack KB data clear: ${error instanceof Error ? error.message : String(error)}`);
      });
      langCacheFlushed = true;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          redisUrlSource: redisConfig.urlSource,
          deletedByPattern,
          contextProjectionCleared: includeContextProjection,
          langCacheFlushed,
          note:
            "Redis indexes and managed Agent Memory service internals were not dropped. Only Attack KB key patterns and optional LangCache entries were cleared.",
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

await main();
