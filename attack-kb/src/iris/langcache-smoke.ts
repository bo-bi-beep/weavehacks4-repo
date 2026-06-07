import "dotenv/config";

import {
  createLangCacheAttackKbLlmCache,
  flushConfiguredLangCache,
  getAttackKbLlmCacheConfig,
  isLangCacheConfigured,
} from "../cache/index.js";

const config = getAttackKbLlmCacheConfig();
const shouldFlush = process.argv.includes("--flush");

if (!isLangCacheConfigured(config)) {
  console.error(
    [
      "Managed Redis LangCache is not configured.",
      "Set LANGCACHE_HOST, LANGCACHE_CACHE_ID, and LANGCACHE_API_KEY in .env.",
      "Create the service from Redis Cloud LangCache first, then rerun this command.",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  if (shouldFlush) {
    await flushConfiguredLangCache(config);
  }

  const cache = createLangCacheAttackKbLlmCache({
    ...config,
    provider: "langcache",
    langCache: {
      ...config.langCache,
      fallbackToLocal: false,
    },
  });

  const request = {
    task: "recommendation-explanation" as const,
    model: "langcache-smoke",
    input: {
      messages: [
        {
          role: "user",
          content:
            "Explain why Attack KB should use cached safe recommendation explanations for repeated credit-loan defensive evaluations.",
        },
      ],
    },
  };

  try {
    const first = await cache.wrap(request, async () => ({
      message:
        "LangCache smoke response: cache safe, repeated Attack KB recommendation explanations without contacting the Agent Under Test.",
      generatedBy: "attack-kb:langcache-smoke",
      generatedAt: new Date().toISOString(),
    }));
    const second = await cache.wrap(request, async () => {
      throw new Error("LangCache smoke expected the second call to hit the managed cache.");
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: cache.provider,
          configured: {
            host: "set",
            cacheId: "set",
            apiKey: "set",
            threshold: config.langCache.similarityThreshold,
          },
          flushedBeforeSmoke: shouldFlush,
          firstCall: {
            hit: first.hit,
            exact: first.exact,
            provider: first.provider,
          },
          secondCall: {
            hit: second.hit,
            exact: second.exact,
            provider: second.provider,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await cache.close?.();
  }
}
