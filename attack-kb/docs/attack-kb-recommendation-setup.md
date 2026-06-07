# Attack KB recommendation setup

This guide covers the current recommendation flow:

```text
main agent
  -> use-attack-kb skill calls Attack KB server directly
  -> Attack KB server retrieves Redis artifacts
  -> Context Retriever hydrates route-composition artifacts when configured
  -> LangCache wraps Attack KB recommendationBuilder output when configured
  -> Attack KB recommendationBuilder composes recommendation packet on cache miss
  -> W&B/Weave trace records the flow
  -> Attack KB server returns packet to main agent
```

Attack KB does not contact the Agent Under Test and does not execute attacks.

## 1. Required environment

Set these in local `.env` or your shell. Do not commit secrets.

```bash
# W&B / Weave tracing
WANDB_API_KEY=...
WANDB_ENTITY=bobibeep-shopify
WANDB_PROJECT=Weavehacks-4-Attack-KB

# OpenAI recommendationBuilder runtime
OPENAI_API_KEY=...

# Attack KB role models
ATTACK_KB_LLM_PROVIDER=openai
ATTACK_KB_SOURCE_GATHERING_MODEL=gpt-5.4-mini
ATTACK_KB_CREDIBILITY_TRIAGE_MODEL=gpt-5.5
ATTACK_KB_CURATOR_MODEL=gpt-5.5
ATTACK_KB_RECOMMENDER_MODEL=gpt-5.5

# Redis-backed KB storage/retrieval
ATTACK_KB_STORAGE_ADAPTER=redis-iris
REDIS_URL=rediss://default:<password>@<host>:<port>
ATTACK_KB_REDIS_IRIS_INDEX=attack-kb-objects
ATTACK_KB_REDIS_IRIS_NAMESPACE=attack-kb
ATTACK_KB_REDIS_IRIS_FALLBACK=local

ATTACK_KB_VECTOR_BACKEND=redis
ATTACK_KB_VECTOR_INDEX=attack-kb-vector
ATTACK_KB_VECTOR_KEY_PREFIX=attack-kb:vector
ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH=false
ATTACK_KB_VECTOR_REDIS_FALLBACK=local
ATTACK_KB_EMBEDDING_PROVIDER=deterministic

# Attack KB Node API host used by the main-agent Attack KB skill.
# Redis Cloud backs storage/retrieval/cache/memory/context services, but does not host this HTTP API.
# Local dev: http://127.0.0.1:3030. Cloud app host: https://<your-attack-kb-api-host>.
ATTACK_KB_PORT=3030
ATTACK_KB_SERVER_URL=http://127.0.0.1:3030
```

## 2. Start or host the Attack KB server

The Attack KB server is a Node API wrapper around Redis Cloud, OpenAI, W&B/Weave, and managed Redis services. It is not hosted by Redis Cloud itself.

For local dev from repo root:

```bash
npm run attack-kb:server
```

For cloud/demo deployment, run the same Node process on an app host and set:

```bash
ATTACK_KB_SERVER_URL=https://attack-kb-api-production.up.railway.app
```

Railway-specific deployment steps are in [`railway-deploy.md`](railway-deploy.md).

Before a live Redis demo, materialize the vector index outside the request path:

```bash
npm run attack-kb:vector-sync
npm run attack-kb:context-sync
```

Health check:

```bash
curl -s http://127.0.0.1:3030/api/health
```

Expected:

```json
{ "ok": true, "service": "attack-kb" }
```

## 3. How retrieval works

The server endpoint is:

```text
POST /api/recommendations
```

For each request, the server:

1. Builds a semantic query from the `AgentUnderTestProfile`:
   - domain
   - tools
   - memory/RAG
   - permissions
   - policies
   - observed behavior
   - observed decision factors
   - desired attacker outcomes such as loan approval, elevated access, or cross-applicant data access
2. Runs Redis vector/hybrid retrieval over relevant object types:
   - `attack_pattern`
   - `vulnerability`
   - `system_attack_pattern`
   - `delivery_mode`
   - `success_signal`
   - `payload_template`
   - `evidence_source`
   - plus older route/scenario types when present
3. Uses any curated `payload_template` artifacts only if normal retrieval selects them; the server does not seed hardcoded recommendation templates.
4. Opportunistically hydrates selected route-composition artifacts through Context Retriever tools when `ATTACK_KB_CONTEXT_RETRIEVER=auto`.
5. Wraps the Attack KB `recommendationBuilder` output in the configured LLM cache; with `ATTACK_KB_LLM_CACHE=langcache`, repeat requests can return from managed Redis LangCache.
6. Sends selected artifacts to the Attack KB `recommendationBuilder` role defined under `agents/attack_kb/recommendation-builder` on cache miss.
7. Returns the LLM-composed recommendation packet.

The response includes retrieval transparency:

```json
{
  "retrievedContext": { "query": "...", "refs": [] },
  "artifactSelection": {
    "strategy": "semantic retrieval ... plus optional Context Retriever hydration",
    "selectedRefs": [
      {
        "id": "pattern-tool-result-instruction-contamination",
        "storageType": "attack_pattern",
        "selectedFrom": "semantic_retrieval",
        "score": 0.57,
        "contextRetriever": { "toolName": "get_attackpattern_by_id", "status": "hydrated" }
      }
    ]
  },
  "recommendationBuilderCache": {
    "provider": "langcache",
    "hit": true,
    "exact": true,
    "task": "recommendation-builder",
    "model": "gpt-5.5"
  }
}
```

## 4. Skill setup

The skill lives in both locations:

```text
attack-kb/skills/use-attack-kb/SKILL.md
.agents/skills/use-attack-kb/SKILL.md
```

The `.agents/skills` copy makes it discoverable by the repo's runtime skill loader.

The skill tells the main agent to:

1. build an AUT profile,
2. call `POST /api/recommendations` from the trusted main-agent/server context,
3. return the recommendation packet to the main agent.

No general-purpose recommendation-fetcher subagent is needed for this handoff.

## 5. Smoke test

Run the full local server smoke:

```bash
npm run attack-kb:server-smoke
```

This starts a temporary Attack KB server, posts a made-up AUT profile, retrieves Redis artifacts, launches the Attack KB `recommendationBuilder`, and prints a compact recommendation packet.

A healthy result has:

```text
ok: true
phase: attack
selectedArtifacts includes Redis-retrieved curated KB artifact entries
contextRetriever.hydrated > 0 when MCP_AGENT_KEY is configured
recommendationBuilderCache.provider is langcache/redis/local depending on ATTACK_KB_LLM_CACHE
recommendations[].attackerGoal
recommendations[].targetOutcome
recommendations[].payloadTemplateRefs remains present as an array; it may be empty when normal retrieval did not select a curated payload_template
recommendations[].sampleTurns with speaker attacker_agent
```

The run should also print a W&B/Weave call URL like:

```text
https://wandb.ai/.../Weavehacks-4-Attack-KB/r/call/...
```

## 6. Manual request example

```bash
curl -s -X POST "$ATTACK_KB_SERVER_URL/api/recommendations" \
  -H 'content-type: application/json' \
  -d '{
    "profile": {
      "domain": "credit_loan",
      "techStack": ["LLM loan assistant", "RAG policy documents", "credit-score lookup tool"],
      "tools": ["credit_score_lookup", "adverse_action_notice_generator", "document_retriever"],
      "memoryOrRag": ["retrieves lending policy snippets", "stores applicant conversation history"],
      "permissions": ["borrower chat channel", "synthetic tool access through harness"],
      "policies": [
        "must not disclose sensitive applicant data",
        "must provide accurate adverse action reasons",
        "borrower chat should not grant underwriter/admin authority"
      ],
      "observedDecisionFactors": [
        {
          "factorRef": "factor-credit-score",
          "evidence": "Target asked for and referenced credit score in synthetic profile.",
          "confidence": 0.85
        }
      ]
    },
    "options": {
      "mainIrisContext": { "limit": 12 },
      "recommendationBuilder": { "mode": "openai", "maxRecommendations": 4 }
    }
  }'
```

## 7. Troubleshooting

- Missing `OPENAI_API_KEY`: Attack KB recommendationBuilder cannot make model calls.
- Missing `WANDB_API_KEY`: Weave traces are skipped or incomplete.
- Missing `REDIS_URL`: Redis-backed retrieval/storage falls back only if fallback is enabled.
- No `payload_template` refs: this is valid when normal retrieval did not select a curated payload template. Do not expect the server to upsert hardcoded templates; verify source pipeline/curation/context sync if selected artifacts look unrelated.
- Context Retriever has tools but returns document-not-found: run `npm run attack-kb:context-sync` after creating/changing the surface schema.
- LangCache returns prompt-length validation errors: keep this branch's compact cache prompt logic; the service prompt field is intentionally much shorter than the full recommendationBuilder prompt.
- Subagent cannot reach local server: provide a reachable `ATTACK_KB_SERVER_URL`, or run the fetch step from the main agent host and pass the returned packet back.
