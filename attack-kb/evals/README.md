# Attack KB evals

Deterministic evaluation harness for Attack KB recommendation quality, ingestion provenance, and curation review behavior.

## Command

From the repo root:

```bash
npm run attack-kb:evals
```

The evals do not call OpenAI. If `WANDB_API_KEY` is set, the eval runner initializes W&B Weave and wraps the cases in `weave.op` calls so recommendation generation, source ingestion, and curation review behavior are visible in Weave traces. Without W&B credentials, the same checks run locally and report `trace: "disabled_missing_wandb_api_key"`.

## Cases

- `empty-profile-probing` — verifies empty credit-loan profile returns probing recommendations, missing info for the four loan factors, KB refs, and the no-direct-AUT boundary.
- `rich-profile-composed-attack` — verifies observed credit-loan factors return composed attack recommendations with business-route and system-pattern refs.
- `ingestion-curation-provenance` — verifies source/data ingestion carries provenance/evidence, fires curation, auto-review proposes an action, and human review persists promoted objects.

All cases are synthetic defensive evaluations only.
