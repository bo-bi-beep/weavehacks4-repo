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
npm run attack-kb:smoke -- "suggest one credit-loan probing recommendation"
npm run typecheck
npm run build
```

`attack-kb:config` validates configuration without making a model call. `attack-kb:probe` returns deterministic recommendations without calling an LLM. With no args it returns probing recommendations; with a rich profile it returns composed attack recommendations. `attack-kb:smoke` makes one traced OpenAI call through the recommendation-builder runtime and will consume OpenAI API usage.

No-API rich-profile demo:

```bash
npm run attack-kb:probe -- --rich-credit-loan
```

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
  src/
    config.ts       env and per-role model config
    runtime.ts      traced OpenAI runtime for subagents
    print-config.ts non-calling config check
    probe-demo.ts   no-API probing recommendation demo
    recommendations.ts deterministic recommendation entrypoint backed by storage adapter
    smoke.ts        optional traced runtime smoke test
    types.ts        P0 request/response/domain/storage object types
    credit-loan/    credit-loan probe, scenario, and route seeds
    storage/        storage interface, local memory/json fallback, Redis Iris adapter boundary
```

Current deterministic KB entities include:

- `DomainDecisionFactor` — likely or observed credit-loan decision variables such as credit score, income, existing loans, and previous fraud history.
- `DomainScenario` — fictional credit-loan profiles used to test observed factors safely.
- `BusinessAttackRoute` — defensive business-route checks that compose financial factors with system-level patterns.
- `AttackRecommendation` — output DTO. Probing recommendations reference `ReconProbe`; rich-profile attack recommendations include `composition`, `businessAttackRouteRefs`, `domainScenarioRefs`, and `systemPatternRefs`.

Future issues will add a concrete Redis Iris client implementation, curation UI, and evals.
