# Deploy Attack KB server on Railway

This deploys the **Attack KB Node API** (`POST /api/recommendations`, `POST /api/recommendations/live`) to Railway. Redis Cloud still backs the KB data/services; Railway only hosts the HTTP wrapper.

## What Railway hosts

```txt
Railway Node service
  -> /api/health
  -> /api/recommendations
  -> /api/recommendations/live
  -> Redis Cloud DB / Query Engine / vector search via REDIS_URL
  -> Redis LangCache
  -> Redis Agent Memory
  -> Redis Context Retriever / Context Surfaces
  -> Attack KB recommendationBuilder via OpenAI
  -> W&B/Weave traces
```

## Repo config

The repo includes `railway.json`:

```json
{
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "npm run attack-kb:server:prod",
    "healthcheckPath": "/api/health"
  }
}
```

Production start command:

```bash
npm run attack-kb:server:prod
```

This runs compiled JS from `dist/attack-kb/src/server-start.js`. The Docker image installs `python3` and `uvx` so Redis Context Retriever hydration can call the `context-surfaces` Python client in production. The build also copies `agents/attack_kb` markdown into `dist/agents/attack_kb` so the production recommendation server can load role instructions.

## Railway variables

Set these in Railway service variables. Do **not** commit secrets.

### Required app/runtime

```bash
NODE_ENV=production
ATTACK_KB_SERVER_URL=https://attack-kb-api-production.up.railway.app
```

Do **not** set `ATTACK_KB_PORT` on Railway. Railway injects `PORT`; the server uses `PORT` automatically when Railway env vars are present.

### W&B / Weave

```bash
WANDB_API_KEY=<secret>
WANDB_ENTITY=bobibeep-shopify
WANDB_PROJECT=Weavehacks-4-Attack-KB
```

### OpenAI

```bash
OPENAI_API_KEY=<secret>
```

### Attack KB model defaults

```bash
ATTACK_KB_LLM_PROVIDER=openai
ATTACK_KB_SOURCE_GATHERING_MODEL=gpt-5.4-mini
ATTACK_KB_CREDIBILITY_TRIAGE_MODEL=gpt-5.5
ATTACK_KB_CURATOR_MODEL=gpt-5.5
ATTACK_KB_RECOMMENDER_MODEL=gpt-5.5
```

### Redis Cloud DB surfaces

```bash
ATTACK_KB_STORAGE_ADAPTER=redis-iris
REDIS_URL=rediss://default:<password>@<host>:<port>
ATTACK_KB_REDIS_IRIS_INDEX=attack-kb-objects
ATTACK_KB_REDIS_IRIS_NAMESPACE=attack-kb
ATTACK_KB_REDIS_IRIS_FALLBACK=disabled
ATTACK_KB_SEED_ON_EMPTY=false

ATTACK_KB_VECTOR_BACKEND=redis
ATTACK_KB_VECTOR_INDEX=attack-kb-vector
ATTACK_KB_VECTOR_KEY_PREFIX=attack-kb:vector
ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH=false
ATTACK_KB_VECTOR_REDIS_FALLBACK=disabled
ATTACK_KB_EMBEDDING_PROVIDER=deterministic
```

### Redis LangCache

```bash
ATTACK_KB_LLM_CACHE=langcache
LANGCACHE_HOST=<host>
LANGCACHE_CACHE_ID=<cache-id>
LANGCACHE_API_KEY=<secret>
LANGCACHE_THRESHOLD=0.92
ATTACK_KB_LANGCACHE_SEARCH_STRATEGIES=exact
ATTACK_KB_LANGCACHE_USE_ATTRIBUTES=false
ATTACK_KB_LANGCACHE_FALLBACK=disabled
ATTACK_KB_LANGCACHE_TIMEOUT_MS=10000
```

Use `ATTACK_KB_LANGCACHE_FALLBACK=disabled` on Railway so the deployed service stays Redis Cloud-backed and fails visibly if LangCache is unavailable.

### Full recommendation response cache

`POST /api/recommendations` caches the full server response by exact request fingerprint. The fingerprint ignores `options.requestId`, so repeated semantic requests can hit even when callers use fresh request IDs. Use `POST /api/recommendations/live` only when diagnosing uncached latency.

```bash
ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE=redis
ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_TTL_SECONDS=86400
ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_KEY_PREFIX=attack-kb:recommendation-response-cache
ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_FALLBACK=disabled
```

Leave `ATTACK_KB_RECOMMENDATION_RESPONSE_CACHE_URL` unset to use `REDIS_URL`.

### Redis memory

Recommendation-run memory uses the Redis DB adapter by default in this app. Keep fallback disabled on Railway:

```bash
ATTACK_KB_MEMORY_ADAPTER=redis
ATTACK_KB_MEMORY_REDIS_PREFIX=attack-kb:memory
ATTACK_KB_MEMORY_REDIS_FALLBACK=disabled
ATTACK_KB_MEMORY_REDIS_TIMEOUT_MS=1500
```

Managed Redis Agent Memory credentials are also available for future attacker/outcome memory workflows:

```bash
MEMORY_API_BASE_URL=<agent-memory-api-base>
MEMORY_STORE_ID=<store-id>
MEMORY_API_KEY=<secret>
MEMORY_OWNER_ID=attack-kb-demo
MEMORY_ACTOR_ID=attack-kb
MEMORY_NAMESPACE=attack-kb
MEMORY_SIMILARITY_THRESHOLD=0.7
MEMORY_LIMIT=6
```

### Redis Context Retriever / Context Surfaces

```bash
ATTACK_KB_CONTEXT_RETRIEVER=auto
ATTACK_KB_CONTEXT_RETRIEVER_MAX_CALLS=8
ATTACK_KB_CONTEXT_RETRIEVER_TIMEOUT_MS=12000
CTX_SURFACE_ID=<surface-id>
MCP_AGENT_KEY=<secret>
```

`CTX_ADMIN_KEY` is not required for normal recommendation serving. Keep it out of Railway unless a Railway job must administer/update the surface.

Materialize Redis vector/context surfaces outside the recommendation request path whenever artifacts or schemas change:

```bash
npm run attack-kb:vector-sync
npm run attack-kb:context-sync
```

## Deploy steps

### Option A: Railway dashboard

1. Create a new Railway project.
2. Add a service from the GitHub repo.
3. Select this repo/branch.
4. Ensure Railway detects `railway.json`.
5. Add variables above.
6. Deploy.
7. In Railway service **Networking**, generate a public domain.
8. Set `ATTACK_KB_SERVER_URL` to that domain, for example:

```bash
ATTACK_KB_SERVER_URL=https://attack-kb-api-production.up.railway.app
```

9. Redeploy after changing `ATTACK_KB_SERVER_URL`.

### Option B: Railway CLI

```bash
railway login
railway link
railway up
```

Then set variables in the dashboard or via CLI. Prefer dashboard for secrets.

## Verify

Health:

```bash
curl -s "$ATTACK_KB_SERVER_URL/api/health"
```

Expected:

```json
{ "ok": true, "service": "attack-kb" }
```

Recommendation smoke from your local shell:

```bash
curl -s -X POST "$ATTACK_KB_SERVER_URL/api/recommendations" \
  -H 'content-type: application/json' \
  -d '{
    "profile": {
      "domain": "credit_loan",
      "techStack": ["LLM loan assistant", "RAG policy documents", "credit-score lookup tool"],
      "tools": ["credit_score_lookup", "adverse_action_notice_generator", "document_retriever"],
      "memoryOrRag": ["retrieves lending policy snippets"],
      "permissions": ["borrower chat channel", "synthetic tool access through harness"],
      "policies": ["must not disclose sensitive applicant data", "must provide accurate adverse action reasons"],
      "observedDecisionFactors": [{ "factorRef": "factor-credit-score", "evidence": "Synthetic baseline used credit score.", "confidence": 0.85 }]
    },
    "options": {
      "mainIrisContext": { "limit": 12 },
      "recommendationBuilder": { "mode": "openai", "maxRecommendations": 4 }
    }
  }' | jq '{requestId, phase, serverRecommendationCache, recommendationBuilderCache, selected: (.artifactSelection.selectedRefs|length), recs: [.recommendations[].id]}'
```

Cached recommendation smoke: repeat the same body against `/api/recommendations` and expect the first response to include `serverRecommendationCache.hit=false`, then the second to include `serverRecommendationCache.hit=true`. Use `/api/recommendations/live` only to measure an uncached request.

## Common failures

- **Healthcheck fails / service does not bind:** do not set `ATTACK_KB_PORT` on Railway; let Railway provide `PORT`. First boot can take several seconds while Node imports W&B/Weave and agent modules.
- **Redis auth/search errors:** verify `REDIS_URL`, Redis modules, `attack-kb-objects`, and `attack-kb-vector` indexes.
- **RecommendationBuilder cannot launch:** verify `OPENAI_API_KEY` and `ATTACK_KB_RECOMMENDER_MODEL`.
- **No Weave trace:** verify `WANDB_API_KEY`, `WANDB_ENTITY`, and `WANDB_PROJECT`.
- **Context Retriever hydration errors:** verify `MCP_AGENT_KEY`, `CTX_SURFACE_ID`, and run `npm run attack-kb:context-sync` locally after schema/artifact changes.
