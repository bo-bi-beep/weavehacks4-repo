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
    recommendations.ts deterministic recommendation entrypoint
    smoke.ts        optional traced runtime smoke test
    types.ts        P0 request/response/domain types
    credit-loan/    credit-loan probe, scenario, and route seeds
```

Current deterministic KB entities include:

- `DomainDecisionFactor` — likely or observed credit-loan decision variables such as credit score, income, existing loans, and previous fraud history.
- `DomainScenario` — fictional credit-loan profiles used to test observed factors safely.
- `BusinessAttackRoute` — defensive business-route checks that compose financial factors with system-level patterns.
- `AttackRecommendation` — output DTO. Probing recommendations reference `ReconProbe`; rich-profile attack recommendations include `composition`, `businessAttackRouteRefs`, `domainScenarioRefs`, and `systemPatternRefs`.

Future issues will add Redis Iris storage, curation UI, and evals.
