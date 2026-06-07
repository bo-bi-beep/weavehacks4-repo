# CopilotKit Weave Demo Dashboard

Replay-first dashboard for the hackathon stage demo. It turns Weave-traced loan
agent attacks into a concise story:

1. baseline scoring,
2. attack round with three sub-agent lanes,
3. patch plus regression false positive,
4. final validation that blocks attacks while preserving normal approvals.

## Run

```bash
npm run dashboard:dev
```

The app runs as a local Next.js app. The CopilotKit sidebar uses
`OPENAI_API_KEY` and `COPILOT_MODEL` (`openai/gpt-4o-mini` by default).

## Replay Data

The MVP uses curated replay data in `lib/replay.ts`. Each case includes:

- expected and actual loan decisions,
- breach and false-positive flags,
- score, threshold, and category scores,
- database truth vs claimed values vs values used by scoring,
- W&B Weave trace/call identifiers and a trace URL.

This keeps the stage demo stable while making Weave the evidence layer. Later,
the same schema can be populated directly from
`agents/main_agent/main_agent_module/trace_exporter.py`.
