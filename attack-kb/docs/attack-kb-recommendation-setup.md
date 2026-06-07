# Attack KB recommendation setup

This guide covers the current recommendation flow:

```text
main agent
  -> spawn recommendation-fetcher subagent using use-attack-kb skill
  -> recommendation-fetcher calls Attack KB server
  -> Attack KB server retrieves Redis artifacts
  -> Blaxel recommendationBuilder composes recommendation packet
  -> W&B/Weave trace records the flow
  -> recommendation-fetcher returns packet to main agent
```

Attack KB does not contact the Agent Under Test and does not execute attacks.

## 1. Required environment

Set these in local `.env` or your shell. Do not commit secrets.

```bash
# W&B / Weave tracing
WANDB_API_KEY=...
WANDB_ENTITY=bobibeep-shopify
WANDB_PROJECT=Weavehacks-4-Attack-KB

# OpenAI + Blaxel sandbox agents
OPENAI_API_KEY=...
BL_API_KEY=...
BL_WORKSPACE=...

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
ATTACK_KB_VECTOR_MATERIALIZE_ON_SEARCH=true
ATTACK_KB_VECTOR_REDIS_FALLBACK=local
ATTACK_KB_EMBEDDING_PROVIDER=deterministic

# Server URL used by the recommendation-fetcher skill/subagent
ATTACK_KB_PORT=3030
ATTACK_KB_SERVER_URL=http://127.0.0.1:3030
```

## 2. Start the Attack KB server

From repo root:

```bash
npm run attack-kb:server
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

1. Ensures reusable `payload_template` recommendation artifacts exist in Redis.
2. Builds a semantic query from the `AgentUnderTestProfile`:
   - domain
   - tools
   - memory/RAG
   - permissions
   - policies
   - observed behavior
   - observed decision factors
   - desired attacker outcomes such as loan approval, elevated access, or cross-applicant data access
3. Runs Redis vector/hybrid retrieval over relevant object types:
   - `attack_pattern`
   - `vulnerability`
   - `system_attack_pattern`
   - `delivery_mode`
   - `success_signal`
   - `payload_template`
   - `evidence_source`
   - plus older route/scenario types when present
4. Runs a focused companion retrieval for `payload_template` artifacts.
5. Sends the selected artifacts to the Blaxel `recommendationBuilder` role agent.
6. Returns the LLM-composed recommendation packet.

The response includes retrieval transparency:

```json
{
  "retrievedContext": { "query": "...", "refs": [] },
  "artifactSelection": {
    "strategy": "semantic retrieval ... plus payload_template companion retrieval",
    "selectedRefs": [
      { "id": "template-tool-output-contamination-approval", "storageType": "payload_template", "selectedFrom": "template_companion", "score": 0.57 }
    ]
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
2. spawn a recommendation-fetcher subagent,
3. have the fetcher call `POST /api/recommendations`,
4. return the recommendation packet to the main agent.

The fetcher does not contact the AUT and does not execute attacks.

## 5. Smoke test

Run the full local server smoke:

```bash
npm run attack-kb:server-smoke
```

This starts a temporary Attack KB server, posts a made-up AUT profile, retrieves Redis artifacts, launches the Blaxel `recommendationBuilder`, and prints a compact recommendation packet.

A healthy result has:

```text
ok: true
phase: attack
selectedArtifacts includes payload_template entries
recommendations[].attackerGoal
recommendations[].targetOutcome
recommendations[].payloadTemplateRefs
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
      "recommendationBuilder": { "mode": "blaxel", "maxRecommendations": 4 }
    }
  }'
```

## 7. Troubleshooting

- Missing `BL_API_KEY` / `BL_WORKSPACE`: Blaxel recommendationBuilder cannot launch.
- Missing `WANDB_API_KEY`: Weave traces are skipped or incomplete.
- Missing `REDIS_URL`: Redis-backed retrieval/storage falls back only if fallback is enabled.
- No `payload_template` refs: rerun the server or smoke; the recommendation path upserts reusable template artifacts before retrieval.
- Subagent cannot reach local server: provide a reachable `ATTACK_KB_SERVER_URL`, or run the fetch step from the main agent host and pass the returned packet back.
