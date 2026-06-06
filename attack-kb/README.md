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
ATTACK_KB_SOURCE_DISCOVERY_MODEL=gpt-4.1-mini
ATTACK_KB_SOURCE_RETRIEVAL_MODEL=gpt-4.1-mini
ATTACK_KB_CREDIBILITY_TRIAGE_MODEL=gpt-4.1
ATTACK_KB_CURATOR_MODEL=gpt-4.1
ATTACK_KB_RECOMMENDER_MODEL=gpt-4.1
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

Redis Iris is exposed as a configurable adapter boundary. This repo does not install a Redis Iris SDK yet; when selected, the stub delegates to the local seeded fallback unless fallback is disabled.

```bash
ATTACK_KB_STORAGE_ADAPTER=redis-iris
ATTACK_KB_REDIS_IRIS_URL=redis://localhost:6379
ATTACK_KB_REDIS_IRIS_INDEX=attack-kb-objects
ATTACK_KB_REDIS_IRIS_NAMESPACE=attack-kb
ATTACK_KB_REDIS_IRIS_FALLBACK=local # or disabled
```

Wire the real Redis Iris client inside `attack-kb/src/storage/redis-iris.ts` when the SDK/runtime is available. The recommendation flow already depends only on the `AttackKbStorageAdapter` interface, so the main path does not need to change.

## Commands

From repo root:

```bash
npm run attack-kb:config
npm run attack-kb:probe
npm run attack-kb:ingest
npm run attack-kb:curation-ui -- --seed-demo
npm run attack-kb:curation-smoke
npm run attack-kb:evals
npm run attack-kb:demo
npm run attack-kb:demo-smoke
npm run attack-kb:smoke -- "suggest one credit-loan probing recommendation"
npm run typecheck
npm run build
```

`attack-kb:config` validates configuration without making a model call. `attack-kb:probe` returns deterministic recommendations without calling an LLM. With no args it returns probing recommendations; with a rich profile it returns composed attack recommendations. `attack-kb:ingest` is a no-OpenAI manual ingestion demo: it stores a sample source plus data item, creates curation candidates, fires the curation queue flow, and prints the resulting candidates. `attack-kb:curation-ui` starts a local human-in-the-loop curation UI; pass `-- --seed-demo` to create sample pending candidates when storage is empty. `attack-kb:curation-smoke` exercises the UI API without opening a browser. `attack-kb:evals` runs deterministic recommendation, ingestion, provenance, and curation-quality evals; if `WANDB_API_KEY` is set, the cases are wrapped in Weave traces. `attack-kb:demo` starts the main-agent flow demo; `attack-kb:demo-smoke` validates the demo API without a browser. `attack-kb:smoke` makes one traced OpenAI call through the recommendation-builder runtime and will consume OpenAI API usage.

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
  skills/
    use-attack-kb/SKILL.md main-agent procedure for using recommendation packets
  evals/          deterministic quality eval harness
  src/
    config.ts       env and per-role model config
    runtime.ts      traced OpenAI runtime for subagents
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
    storage/        storage interface, local memory/json fallback, Redis Iris adapter boundary
```

Current deterministic KB entities include:

- `DomainDecisionFactor` — likely or observed credit-loan decision variables such as credit score, income, existing loans, and previous fraud history.
- `DomainScenario` — fictional credit-loan profiles used to test observed factors safely.
- `BusinessAttackRoute` — defensive business-route checks that compose financial factors with system-level patterns.
- `AttackRecommendation` — output DTO. Probing recommendations reference `ReconProbe`; rich-profile attack recommendations include `composition`, `businessAttackRouteRefs`, `domainScenarioRefs`, and `systemPatternRefs`.

Future follow-up work can replace the Redis Iris stub with a concrete client and connect the main attack agent to this subsystem over its final API boundary.
