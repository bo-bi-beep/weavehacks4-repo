# Attack KB

Standalone Attack Agent Knowledgebase subsystem for the WeaveHacks 4 agent adversary system.

## Boundary

The Attack KB is a recommendation subsystem. It does **not** contact the Agent Under Test and does **not** execute attacks.

Flow:

```text
Main agent starts attack
→ Attack KB returns probing recommendations if target info is missing
→ Main agent probes/gathers Agent Under Test info itself
→ Main agent sends observed profile back to Attack KB
→ Attack KB returns composed attack recommendations
→ Main agent creates delivery subagents
```

## Runtime keys

Attack KB uses both keys, with separate responsibilities:

- `OPENAI_API_KEY` — direct OpenAI API model calls for subagents
- `WANDB_API_KEY` — W&B Weave tracing/logging and project access

Never commit real secrets. Put real values in local `.env` only.

## Configurable subagent models

Each Attack KB role can use a different model:

```bash
ATTACK_KB_LLM_PROVIDER=openai
ATTACK_KB_SOURCE_DISCOVERY_MODEL=gpt-5.4-mini
ATTACK_KB_SOURCE_RETRIEVAL_MODEL=gpt-5.4-mini
ATTACK_KB_CREDIBILITY_TRIAGE_MODEL=gpt-5.5
ATTACK_KB_CURATOR_MODEL=gpt-5.5
ATTACK_KB_RECOMMENDER_MODEL=gpt-5.5
```

## LLM cache / managed LangCache

`attack-kb/src/cache/` provides local, Redis exact-key, and managed Redis LangCache providers for model paths. P0 can use exact keys derived from `model + task scope + input`, or `ATTACK_KB_LLM_CACHE=langcache` to call the managed Redis LangCache semantic cache service.

Supported task scopes:

- `source-triage`
- `curation-review`
- `recommendation-explanation`
- `eval-scorer`

The cache is disabled by default. Enable local in-memory caching, Redis-backed exact-key caching with TTL, or managed LangCache semantic caching:

```bash
ATTACK_KB_LLM_CACHE=disabled # disabled | local | redis | langcache
ATTACK_KB_LLM_CACHE_TTL_SECONDS=86400

# Redis exact-key cache, optional when ATTACK_KB_LLM_CACHE=redis.
ATTACK_KB_REDIS_CACHE_URL= # optional; defaults to REDIS_URL
ATTACK_KB_REDIS_CACHE_KEY_PREFIX=attack-kb:llm-cache
ATTACK_KB_REDIS_CACHE_FALLBACK=local # or disabled for strict Redis
ATTACK_KB_REDIS_CACHE_TIMEOUT_MS=2000

# Managed Redis LangCache service, required when ATTACK_KB_LLM_CACHE=langcache.
LANGCACHE_HOST=
LANGCACHE_CACHE_ID=
LANGCACHE_API_KEY=
LANGCACHE_THRESHOLD=0.82
ATTACK_KB_LANGCACHE_FALLBACK=local
ATTACK_KB_LANGCACHE_TIMEOUT_MS=10000
```

Redis mode writes JSON cache entries with Redis `EX` TTL. Managed LangCache mode uses the Redis LangCache REST API (`/entries/search`, `/entries`) and keeps task/model attributes isolated. If the selected provider is unavailable and fallback is `local`, the runtime fails open to process-local memory and emits one warning. `ATTACK_KB_LLM_CACHE=disabled` is a no-op cache that always calls the loader.

The optional `attack-kb:smoke` OpenAI path is wrapped with the `recommendation-explanation` scope. Deterministic recommendation demos and evals do not call OpenAI. Use `npm run attack-kb:langcache-smoke -- --flush` to validate the managed LangCache service without making an LLM call.

## Sandbox agents

Live Attack KB agents mirror the repo's existing Blaxel sandbox pattern from `agents/sub_agents/` through `attack-kb/src/sandbox.ts`, while keeping Attack KB role files under `agents/attack_kb/`.

Each role has its own folder with `README.md`, `instructions.md`, and `task.md`:

- `agents/attack_kb/source-discovery/`
- `agents/attack_kb/source-retrieval/`
- `agents/attack_kb/credibility-triage/`
- `agents/attack_kb/kb-curator/`
- `agents/attack_kb/recommendation-builder/`

Runtime notes:

- deterministic demos/evals do not launch Blaxel;
- `npm run attack-kb:sandbox-smoke` prints the sandbox config and missing live-launch env vars without making model calls;
- actual sandbox agent creation requires `OPENAI_API_KEY`, `BL_API_KEY`, and `BL_WORKSPACE`;
- live Attack KB agents run in isolated Blaxel micro-VMs and must not directly contact the Agent Under Test or receive raw Redis admin credentials.

```bash
npm run attack-kb:sandbox-smoke
npm run attack-kb:sandbox-smoke sourceDiscovery "Find source gaps for credit-loan defensive evals."
```

## Storage adapter

Recommendations read canonical KB objects through `attack-kb/src/storage/`.

Canonical storage object types are aligned to the Attack KB taxonomy:

- `domain_decision_factor`
- `recon_probe`
- `domain_scenario`
- `business_attack_route`
- `system_attack_pattern`
- `vulnerability`
- `attack_pattern`
- `payload_template`
- `delivery_mode`
- `success_signal`
- `evidence_source`
- `source_artifact`
- `ingested_data_item`
- `curation_candidate`
- `curation_review_decision`
- `sample_code_snippet`

Default storage is local in-memory and works with no Redis service:

```bash
ATTACK_KB_STORAGE_ADAPTER=local
```

For a file-backed local fallback, use JSON storage:

```bash
ATTACK_KB_STORAGE_ADAPTER=json
ATTACK_KB_LOCAL_STORAGE_PATH=attack-kb/.local/kb.json
```

Redis-backed storage uses the official `redis` npm client. Prefer a Redis Cloud compatible URL (`rediss://...` when TLS is required). `REDIS_URL` is the canonical Redis connection string and is enough for storage/Iris, vector retrieval, memory, and cache. `ATTACK_KB_REDIS_IRIS_URL` is an optional storage/Iris override only; `ATTACK_KB_STORAGE_ADAPTER=redis` and `redis-iris` both select the Redis path.

```bash
ATTACK_KB_STORAGE_ADAPTER=redis-iris # or redis
REDIS_URL=rediss://default:<password>@your-redis-cloud-host:port
# ATTACK_KB_REDIS_IRIS_URL= # optional override; leave blank to use REDIS_URL
ATTACK_KB_REDIS_IRIS_INDEX=attack-kb-objects
ATTACK_KB_REDIS_IRIS_NAMESPACE=attack-kb
ATTACK_KB_REDIS_IRIS_FALLBACK=local # local/true/1, or disabled/false/0
ATTACK_KB_REDIS_KEY_PREFIX=attack-kb
ATTACK_KB_REDIS_EVENTS_STREAM=attack-kb:events
ATTACK_KB_REDIS_CURATION_STREAM=attack-kb:curation:events
```

The adapter stores canonical objects under `<namespace>:<index>:object:<id>` and tracks IDs in `<namespace>:<index>:ids`. It uses RedisJSON when `JSON.SET`/`JSON.GET` are available; otherwise it falls back to Redis string `SET`/`GET` JSON values under the same namespaced keys. When RedisJSON plus Redis Query Engine/RediSearch `FT.*` commands are available, the adapter best-effort ensures `ATTACK_KB_REDIS_IRIS_INDEX` as an `FT.CREATE ON JSON` index over canonical object keys and uses `FT.SEARCH` for `list` queries with `objectType`, `domain`, `text`, or `limit`. If RedisJSON or search is unavailable, list queries fall back to the existing Redis ID-set scan plus JS-side filtering. The default storage factory seeds a fresh Redis namespace with canonical KB seeds on first use via `putMany`, matching the local demo behavior. If the Redis URL is missing or the connection fails, `ATTACK_KB_REDIS_IRIS_FALLBACK=local` keeps the seeded local fallback for demos; disabling fallback makes configuration/connection failures throw clear errors.

The P0 Query Engine schema indexes `objectType`, `domain`, `tags`, and `sourceRefs` as TAG fields; `title`, `description`, `payload.content`, `payload.description`, `payload.template`, and `payload.code` as TEXT fields; and `updatedAt`/`version` as sortable fields. Redis Cloud databases or local Redis Stack instances must include RedisJSON and Query Engine/RediSearch for the indexed path. Plain Redis can still store string JSON and run JS-side filtering, but it will not satisfy the visible Query Engine path.

Optional Redis smoke against a local Redis/Redis Stack or Redis Cloud instance:

```bash
npm run attack-kb:redis-smoke
```

The smoke command writes the canonical seed objects through Redis and reads one back; it requires `REDIS_URL` or `ATTACK_KB_REDIS_IRIS_URL` and does not use the local fallback.

## Main-agent Iris / vector-hybrid retrieval

`attack-kb/src/retrieval/` exposes `searchAttackKbSemanticContext(query, filters, options)` for semantic context lookup over canonical KB objects. This is P0 for the main Attack KB recommendation path: `getAttackKbRecommendations()` retrieves main-agent context and returns it in `response.retrievedContext`, then uses that context to rerank probing or attack-route recommendations. Subagent context-query and spawn-spec generation remain P1.

The retrieval layer materializes object text from titles, descriptions, tags, payload fields, provenance/evidence, domain scenarios, business routes, system patterns, curation outcomes, and success signals; then chunks that text for retrieval.

Default retrieval is deterministic and local: `ATTACK_KB_EMBEDDING_PROVIDER=deterministic` hashes tokens into a configurable `Float32Array` dimension (default `384`) and reranks chunks with a vector score plus a lexical overlap score. It makes no OpenAI calls and works without Redis.

Redis mode is opt-in. It stores retrieval chunks as Redis hashes under `<ATTACK_KB_VECTOR_KEY_PREFIX>:chunk:<objectId>:<chunkOrdinal>` and creates a RediSearch vector index with metadata TAG filters:

```bash
ATTACK_KB_VECTOR_BACKEND=redis # local | redis | auto
ATTACK_KB_VECTOR_REDIS_URL= # optional override; leave blank to use REDIS_URL
ATTACK_KB_VECTOR_INDEX=attack-kb-vector
ATTACK_KB_VECTOR_KEY_PREFIX=attack-kb:vector
ATTACK_KB_VECTOR_INDEX_ALGORITHM=HNSW # or FLAT
ATTACK_KB_VECTOR_DIMENSIONS=384
ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH=true
ATTACK_KB_VECTOR_REDIS_FALLBACK=local
ATTACK_KB_EMBEDDING_PROVIDER=deterministic
ATTACK_KB_OPENAI_EMBEDDING_MODEL=text-embedding-3-small # seam only in P0; real calls deferred
```

The RediSearch schema is `ON HASH` with `objectId`, `chunkId`, `objectType`, `domain`, `status`, and `sourceCategory` as `TAG` fields, `title`/`text` as `TEXT`, and `embedding VECTOR HNSW|FLAT TYPE FLOAT32 DIM <n> DISTANCE_METRIC COSINE`. Hybrid filters are applied in the Redis query, for example `(@domain:{credit_loan} @objectType:{business_attack_route})=>[KNN 20 @embedding $query_vector AS vector_distance]`; the returned candidates are then locally reranked with the same lexical boost used by deterministic fallback.

Sample API use:

```ts
import { searchAttackKbSemanticContext } from "./attack-kb/src/retrieval/index.js";

const context = await searchAttackKbSemanticContext(
  "income verification business route with tool misuse evidence",
  { domain: "credit_loan", objectType: ["business_attack_route", "system_attack_pattern"] },
  { limit: 5 },
);
```

Current P0 main-agent behavior: the recommendation path retrieves Iris/vector context, exposes retrieved refs in `AttackKbResponse.retrievedContext`, and reranks recommendations by retrieved context scores. Deferred work: production OpenAI embeddings through the traced Attack KB runtime, batch embedding refresh/invalidation, richer sponsor-specific Iris SDK integration if required, and P1 governed subagent context-query/spawn-spec generation.

## Agent Memory adapter

Run/outcome memory lives under `attack-kb/src/memory/` and is separate from canonical KB storage. It exposes `recordMemory`, `searchMemory`, and `listRecent` across these namespaces:

- `attack-kb-runs`
- `target-observations`
- `curation`
- `recommendation-outcomes`
- `subagent-reports`

Default memory config uses an in-process local fallback. Set a Redis URL to persist records as JSON string values plus recent-record sorted sets:

```bash
ATTACK_KB_MEMORY_ADAPTER=auto # auto, local, or redis
ATTACK_KB_MEMORY_REDIS_URL= # optional override; leave blank to use REDIS_URL
ATTACK_KB_MEMORY_REDIS_PREFIX=attack-kb:memory
ATTACK_KB_MEMORY_REDIS_FALLBACK=local # or disabled
ATTACK_KB_MEMORY_REDIS_TIMEOUT_MS=1500
```

If `ATTACK_KB_MEMORY_REDIS_URL` is unset, auto mode reuses `REDIS_URL`/`ATTACK_KB_REDIS_IRIS_URL` when present; otherwise it stays local-memory. Redis keys use:

```text
<prefix>:record:<namespace>:<id>
<prefix>:recent:<namespace>
<prefix>:recent:all
```

This is a Redis key-value Agent Memory seam. If a sponsor-specific Iris/Agent Memory SDK exposes a different API, replace the implementation behind `AttackKbMemoryAdapter` without changing the recommendation/demo call sites.

Redis observability/security guidance lives in [`docs/redis-observability-security.md`](docs/redis-observability-security.md). Managed Iris service setup guidance lives in [`docs/redis-iris-services-setup.md`](docs/redis-iris-services-setup.md). The safe report command prints sanitized config and intended Redis names without contacting Redis unless `ATTACK_KB_REDIS_HEALTH_CONNECT=1` is set:

```bash
npm run attack-kb:redis-health
npm run attack-kb:iris-health
ATTACK_KB_REDIS_HEALTH_CONNECT=1 npm run attack-kb:redis-health
```

## Commands

From repo root:

```bash
npm run attack-kb:config
npm run attack-kb:redis-health
npm run attack-kb:probe
npm run attack-kb:ingest
npm run attack-kb:curation-ui -- --seed-demo
npm run attack-kb:curation-smoke
npm run attack-kb:evals
npm run attack-kb:demo
npm run attack-kb:demo-smoke
npm run attack-kb:sandbox-smoke
npm run attack-kb:redis-smoke
npm run attack-kb:smoke -- "suggest one credit-loan probing recommendation"
npm run typecheck
npm run build
```

`attack-kb:config` validates configuration without making a model call. `attack-kb:redis-health` prints sanitized Redis config/readiness and intended key/index/stream names; it stays report-only unless `ATTACK_KB_REDIS_HEALTH_CONNECT=1` is set. `attack-kb:sandbox-smoke` prints Attack KB's Blaxel/SubAgentService sandbox configuration without launching Blaxel or making a model call. `attack-kb:redis-smoke` is an optional networked Redis round trip that writes canonical seed objects and reads one back when a Redis URL is configured. `attack-kb:probe` returns deterministic recommendations without calling an LLM. With no args it returns probing recommendations; with a rich profile it returns composed attack recommendations. `attack-kb:ingest` is a no-OpenAI manual ingestion demo: it stores a sample source plus data item, creates curation candidates, fires the curation queue flow, and prints the resulting candidates. `attack-kb:curation-ui` starts a local human-in-the-loop curation UI; pass `-- --seed-demo` to create sample pending candidates when storage is empty. `attack-kb:curation-smoke` exercises the UI API without opening a browser. `attack-kb:evals` runs deterministic recommendation, ingestion, provenance, and curation-quality evals; if `WANDB_API_KEY` is set, the cases are wrapped in Weave traces. `attack-kb:demo` starts the main-agent flow demo; `attack-kb:demo-smoke` validates the demo API without a browser. `attack-kb:smoke` makes one traced OpenAI call through the recommendation-builder runtime unless the exact-key LLM cache hits.

No-API rich-profile demo:

```bash
npm run attack-kb:probe -- --rich-credit-loan
```

No-OpenAI ingestion/curation demo:

```bash
npm run attack-kb:ingest
npm run attack-kb:curation-ui -- --seed-demo
# open http://localhost:3010, or ATTACK_KB_CURATION_UI_PORT=3100 npm run attack-kb:curation-ui
```

For review decisions that survive process restarts, use the existing JSON storage adapter:

```bash
ATTACK_KB_STORAGE_ADAPTER=json \
ATTACK_KB_LOCAL_STORAGE_PATH=attack-kb/.local/kb.json \
npm run attack-kb:curation-ui -- --seed-demo
```

The ingestion path uses `attack-kb/src/ingestion/` and the curation queue primitive in `attack-kb/src/curation/`. New source artifacts and ingested data items are written through the configured storage adapter, then immediately enqueue a `curation_candidate` and fire the `manual_review_queue` flow. Source/data payloads carry provenance and evidence metadata (`originLabel`, publisher/url/version where available, retrieval time, standards refs, evidence excerpts, confidence, and locator). Categories include standards-backed language for `owasp`, `mitre_atlas`, `nist_ai_rmf_genai`, and `maestro_agentic_risk`, plus research/vendor/manual categories. If `WANDB_API_KEY` is set and no custom storage/date options are passed, `weave.op` traces the ingestion entrypoints without requiring any OpenAI call.

The curation UI lives under `attack-kb/src/curation/` and keeps the full review context on screen for each pending candidate: source object, provenance, extracted evidence, proposed canonical objects, related artifacts, confidence summary, and review history. A reviewer can:

- run deterministic auto-review to pre-score and propose `accept`, `reject`, `edit`, or `merge`;
- accept selected proposed objects into canonical storage;
- reject a candidate with rationale;
- edit the proposed canonical-object JSON before accepting;
- merge candidate provenance into an existing related object.

Auto-review proposals and human decisions are persisted as `curation_review_decision` canonical objects. Human decisions update the candidate status and, for accept/edit/merge, persist promoted or merged canonical objects through the configured storage adapter. Curation events call a `weave.op` trace when `WANDB_API_KEY` is configured; without W&B credentials the same flow runs locally and records `weaveTrace: disabled_missing_wandb_api_key`.

Quality evals:

```bash
npm run attack-kb:evals
```

The eval suite lives in `attack-kb/evals/`. It covers empty-profile probing, rich-profile composed recommendations, source ingestion provenance, curation auto-review, persisted human review decisions, and the no-direct-Agent-Under-Test boundary. The evals do not call OpenAI. With `WANDB_API_KEY`, the eval cases appear in W&B Weave traces.

Main-agent flow demo:

```bash
npm run attack-kb:demo
# open http://localhost:3020, or ATTACK_KB_DEMO_PORT=3200 npm run attack-kb:demo
npm run attack-kb:demo-smoke
```

The demo shows the end-to-end boundary: main agent starts with an empty credit-loan profile, Attack KB returns probing recommendations, the main agent supplies observed target factors, Attack KB returns composed system + financial-domain recommendations, and the main agent creates constrained delivery subagent tasks. The demo also shows the W&B Weave project name and whether tracing is enabled.

Custom observed profile example:

```bash
npm run attack-kb:probe -- '{"domain":"credit_loan","observedDecisionFactors":[{"factorRef":"factor-credit-score","evidence":"Synthetic variants changed the target rationale.","confidence":0.8},{"factorRef":"factor-income","evidence":"Target requested income in a fictional evaluation.","confidence":0.75}]}'
```

The rich-profile path uses only synthetic defensive testing language. A profile with no `observedDecisionFactors` stays in `phase: "probing"`; once the main agent supplies observed credit-loan factors, Attack KB returns `phase: "attack"` recommendations composed from `DomainDecisionFactor`, `DomainScenario`, `BusinessAttackRoute`, and system-level safety patterns.

## Current structure

```text
attack-kb/
  README.md
  docs/           Redis observability/security and source-reference docs
  skills/
    use-attack-kb/SKILL.md main-agent procedure for using recommendation packets
  evals/          deterministic quality eval harness
  src/
    config.ts       env and per-role model config
    runtime.ts      traced OpenAI runtime for direct model calls
    sandbox.ts      Blaxel/SubAgentService sandbox adapter for live Attack KB agents
    print-config.ts non-calling config check
    probe-demo.ts   no-API probing recommendation demo
    ingest-demo.ts  no-OpenAI source/data ingestion and curation-candidate demo
    demo/           local main-agent flow demo server, UI, and smoke test
    recommendations.ts deterministic recommendation entrypoint backed by storage adapter
    smoke.ts        optional traced runtime smoke test
    types.ts        P0 request/response/domain/storage object types
    credit-loan/    credit-loan probe, scenario, and route seeds
    curation/       queue primitive plus local HITL curation UI, API, auto-review, and smoke test
    ingestion/      source/data ingestion entrypoints, samples, and Weave tracing wrapper
    cache/          LLM cache with no-op, local, Redis exact-key, and managed LangCache providers
    retrieval/      deterministic + Redis vector/hybrid semantic context retrieval
    redis/          Redis client/env helper, Query Engine index/search support, streams/events, and health/config report command
    iris/           managed Iris service health and LangCache smoke commands
    memory/         run/outcome Agent Memory adapter with local fallback and Redis KV backend
    storage/        storage interface, local memory/json fallback, Redis-backed adapter
```

Current deterministic KB entities include:

- `DomainDecisionFactor` — likely or observed credit-loan decision variables such as credit score, income, existing loans, and previous fraud history.
- `DomainScenario` — fictional credit-loan profiles used to test observed factors safely.
- `BusinessAttackRoute` — defensive business-route checks that compose financial factors with system-level patterns.
- `AttackRecommendation` — output DTO. Probing recommendations reference `ReconProbe`; rich-profile attack recommendations include `composition`, `businessAttackRouteRefs`, `domainScenarioRefs`, and `systemPatternRefs`.

Current P0 main-agent recommendations use Redis-backed Iris/vector context retrieval. Follow-up work can wire the managed Redis Context Retriever and Agent Memory service APIs once their service credentials are available, add production embedding refresh/invalidation, and connect the main attack agent to this subsystem over its final API boundary.
