# Attack KB agents

Attack KB-owned agent role definitions live here under the repo's root `agents/` folder.

Each role has its own folder with:

- `README.md` — role purpose and boundaries
- `instructions.md` — system-style instructions mounted into the sandbox agent
- `task.md` — default task seed for dry-run specs or live sandbox creation

Runtime wiring lives in `attack-kb/src/sandbox.ts`. It reads these role files and
then uses the repo's shared Blaxel `SubAgentService` as the sandbox backend.
Attack KB agents are advisory only: they do not directly contact the Agent Under
Test and do not receive raw Redis admin credentials.

## Roles

- `source-gathering/`
- `credibility-triage/`
- `kb-curator/`
- `recommendation-builder/`
