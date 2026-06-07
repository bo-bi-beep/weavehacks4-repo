# Attack KB agents

Attack KB-owned agent role definitions live here under the repo's root `agents/` folder.

Each role has its own folder with:

- `README.md` — role purpose and boundaries
- `instructions.md` — system-style instructions mounted into the sandbox agent
- `task.md` — default task seed for dry-run specs or live sandbox creation

Runtime wiring for recommendation serving lives in `attack-kb/src/recommendations.ts` and `attack-kb/src/runtime.ts`. The server reads the role files in this folder and calls the Attack KB Recommendation Builder directly through the Attack KB runtime; it does not route recommendation generation through the repo's general sub-agent service. Attack KB agents are advisory only: they do not directly contact the Agent Under Test and do not receive raw Redis admin credentials.

## Roles

- `source-gathering/`
- `credibility-triage/`
- `kb-curator/`
- `recommendation-builder/`
