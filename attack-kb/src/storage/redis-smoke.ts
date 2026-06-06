import "dotenv/config";

import { getAttackKbStorageConfig } from "./index.js";
import { createRedisIrisAttackKbStorageAdapter } from "./redis-iris.js";
import { buildSeedAttackKbObjects } from "./seeds.js";

const storageConfig = getAttackKbStorageConfig();

if (!storageConfig.redisIris.url) {
  console.error(
    "Set ATTACK_KB_REDIS_IRIS_URL or REDIS_URL to run the optional Redis Attack KB smoke.",
  );
  process.exitCode = 1;
} else {
  const adapter = createRedisIrisAttackKbStorageAdapter({
    config: {
      ...storageConfig.redisIris,
      fallbackToLocal: false,
    },
  });

  try {
    const seeds = buildSeedAttackKbObjects();
    const firstSeed = seeds[0];

    await adapter.putMany(seeds);
    const roundTrip = await adapter.get(firstSeed.id);
    const listed = await adapter.list({
      ids: [firstSeed.id],
      objectType: firstSeed.objectType,
      limit: 1,
    });

    if (!roundTrip || listed.length !== 1) {
      throw new Error("Redis Attack KB smoke failed to read back the canonical seed object.");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          adapter: adapter.name,
          backend: adapter.backend,
          urlSource: storageConfig.redisIris.urlSource,
          namespace: storageConfig.redisIris.namespace,
          indexName: storageConfig.redisIris.indexName,
          seedObjectsWritten: seeds.length,
          roundTripObjectId: roundTrip.id,
          storageMode: "redis-json-when-available-else-string-json",
        },
        null,
        2,
      ),
    );
  } finally {
    await adapter.close?.();
  }
}
