# Redis Iris managed services setup

This guide separates the Redis Cloud **database** from Redis Iris **managed services**.

- `REDIS_URL` is enough for the Redis database features: RedisJSON, Query Engine/RediSearch, and vector search.
- Iris managed services need their own service credentials and may appear separately in the Redis Cloud console:
  - LangCache
  - Agent Memory
  - Context Retriever / Context Surfaces

Do not paste service keys into chat. Put them in local `.env` only.

## Current Attack KB env shape

```bash
# Redis Cloud database
REDIS_URL=redis://default:<password>@<host>:<port>

# Managed Redis LangCache service
LANGCACHE_HOST=
LANGCACHE_CACHE_ID=
LANGCACHE_API_KEY=
LANGCACHE_THRESHOLD=0.82
ATTACK_KB_LLM_CACHE=langcache
ATTACK_KB_LANGCACHE_USE_ATTRIBUTES=false # keep false unless the service has configured attributes
ATTACK_KB_LANGCACHE_FALLBACK=disabled # use local for demos if you want fail-open

# Managed Redis Agent Memory service
MEMORY_API_BASE_URL=
MEMORY_STORE_ID=
MEMORY_API_KEY=
MEMORY_OWNER_ID=attack-kb-demo
MEMORY_ACTOR_ID=attack-kb
MEMORY_NAMESPACE=attack-kb
MEMORY_SIMILARITY_THRESHOLD=0.7
MEMORY_LIMIT=6

# Managed Redis Context Retriever / Context Surfaces
CTX_ADMIN_KEY=
CTX_SURFACE_ID=
MCP_AGENT_KEY=
CTX_REDIS_INSTANCE_ID=
```

Check masked readiness:

```bash
npm run attack-kb:config
npm run attack-kb:iris-health
```

## LangCache

### Get credentials

Redis Cloud Console:

1. Open **LangCache** from the left menu under Context Engine / AI services.
2. Select **New service** or **Quick create**.
3. Choose the existing Attack KB Redis database.
4. Use Redis or OpenAI embeddings. If choosing OpenAI embeddings, provide the OpenAI embedding key in the Redis Cloud UI.
5. Create the service.
6. Copy the service key immediately. Redis shows it only once.
7. Fill local `.env`:

```bash
LANGCACHE_HOST=<LangCache API base URL or host>
LANGCACHE_CACHE_ID=<cache id>
LANGCACHE_API_KEY=<one-time service key/API token>
LANGCACHE_THRESHOLD=0.82
ATTACK_KB_LLM_CACHE=langcache
ATTACK_KB_LANGCACHE_USE_ATTRIBUTES=false
```

### CLI/API validation

Run the project smoke. It optionally flushes the cache, stores a deterministic response, then confirms the second call hits managed LangCache. If Redis Cloud says `attributes: no attributes are configured for this cache`, keep `ATTACK_KB_LANGCACHE_USE_ATTRIBUTES=false`:

```bash
npm run attack-kb:langcache-smoke -- --flush
```

Raw REST CLI equivalent:

```bash
# If LANGCACHE_HOST already includes https://, keep it as-is.
HOST="$LANGCACHE_HOST"
CACHE_ID="$LANGCACHE_CACHE_ID"
API_KEY="$LANGCACHE_API_KEY"

curl -s -X POST "$HOST/v1/caches/$CACHE_ID/entries/search" \
  -H "accept: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{"prompt":"Attack KB LangCache setup check","searchStrategies":["exact","semantic"]}'

curl -s -X POST "$HOST/v1/caches/$CACHE_ID/entries" \
  -H "accept: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "content-type: application/json" \
  -d '{"prompt":"Attack KB LangCache setup check","response":"LangCache is connected for Attack KB."}'
```

### Attack KB usage

When `ATTACK_KB_LLM_CACHE=langcache`, `attack-kb/src/cache/` uses the managed LangCache REST API for `runtime.llmCache.wrap(...)`. The optional OpenAI smoke path exercises it:

```bash
npm run attack-kb:smoke -- "suggest one safe credit-loan probing recommendation"
```

## Agent Memory

Agent Memory is a managed Redis Iris REST service. It does **not** use `REDIS_URL` for runtime API calls. You need a separate service API key.

### Get credentials

Redis Cloud Console:

1. Open **Agent Memory** from Context Engine / AI services.
2. Create an Agent Memory service/store for the Attack KB database.
3. Open the service/store access or API key section.
4. Create/copy the Agent Memory service key. This is the value for `MEMORY_API_KEY` and may only be shown once.
5. Copy:
   - API base URL
   - store ID
   - API key / service key
6. Fill local `.env`:

```bash
MEMORY_API_BASE_URL=<Agent Memory REST API base URL>
MEMORY_STORE_ID=<store id>
MEMORY_API_KEY=<service API key>
MEMORY_OWNER_ID=attack-kb-demo
MEMORY_ACTOR_ID=attack-kb
MEMORY_NAMESPACE=attack-kb
MEMORY_SIMILARITY_THRESHOLD=0.7
MEMORY_LIMIT=6
```

If you do not see an API key/service-key button, the Agent Memory preview/service is probably not enabled for the Redis Cloud account yet, or the Agent Memory store has not been created. Ask Redis/hackathon support to enable Redis Iris / Context Engine Agent Memory access.

Current code still has a Redis DB key-value memory adapter for run/outcome notes. Once managed Agent Memory credentials are present, wire the adapter behind `AttackKbMemoryAdapter` to the managed REST API endpoints:

- `POST /v1/stores/{storeId}/long-term-memory`
- `POST /v1/stores/{storeId}/long-term-memory/search`
- `POST /v1/stores/{storeId}/session-memory/events`

## Context Retriever / Context Surfaces

### Get credentials

Redis Cloud Console:

1. Open **Context Retriever** / **Context Surfaces** from Context Engine / AI services.
2. Create a service for the Attack KB Redis database.
3. Define a context surface/model over Attack KB entities, for example:
   - canonical KB object
   - vulnerability
   - attack pattern
   - evidence source
   - source artifact
   - curation candidate/review
4. Create or deploy the surface.
5. Copy:
   - admin key
   - context surface ID
   - MCP agent key
   - Redis instance/database ID if shown/required
6. Fill local `.env`:

```bash
CTX_ADMIN_KEY=<admin/setup key>
CTX_SURFACE_ID=<surface id>
MCP_AGENT_KEY=<agent/runtime key>
CTX_REDIS_INSTANCE_ID=<Redis database/instance id if required>
```

The Redis Iris demo project uses the `context_surfaces` Python SDK and a setup script to create a surface. The important runtime key for agents is `MCP_AGENT_KEY`; it lets the app list/call generated Context Retriever tools without exposing raw Redis credentials.

## Troubleshooting

- If Redis Cloud shows only the database and no LangCache/Agent Memory/Context Retriever menus, the account may not have Iris/Context Engine preview enabled.
- LangCache public preview does not support databases with a CIDR allow list, Active-Active databases, or databases with the default user disabled.
- Service keys are separate from Redis database passwords. `REDIS_URL` cannot authenticate to LangCache, Agent Memory, or Context Retriever.
- Prefer `rediss://` for Redis database traffic when Redis Cloud provides a TLS endpoint.
