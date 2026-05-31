# DEVNS Codex Plugin

This plugin package gives Codex a DEVNS workflow surface:

- `devns-init`: initialize or refresh a DEVNS workspace and discover candidate features. It does not implement code.
- `devns-rfc`: clarify a candidate or feature into a reviewable RFC before implementation.
- `devns-run`: continue the active feature or claim one approved feature for implementation.
- `.codex-plugin/plugin.json`: Codex plugin manifest with identity, presentation metadata, and `skills` discovery path.
- `scripts/devns-stop-hook.sh`: optional host adapter target for lifecycle stop hooks.
- `hooks/README.md`: hook boundary and manual wiring notes.
- `prompts/`: reusable prompt contracts for RFC clarification, code review lanes, Stop hook continuation, and domain knowledge curation.

Start every uncertain session with the deterministic workspace check when the target project exposes it:

```sh
npm run devns:doctor -- --json
```

If that alias is missing, inspect `package.json` and use the available DEVNS status command, usually `npm run devns:status -- --json` or `npm run devns:queue -- status --json`.

Then follow the returned mode:

- `bootstrap_required`: use `devns-init`.
- `continue_active`: use `devns-run` and continue only the active feature.
- `claim_next`: use `devns-run` to claim one approved feature.
- `blocked_ready`: use `devns-rfc` or ask the human to approve/update the RFC.
- `empty_queue`: stop unless the human adds more candidates or features.

The plugin is a thin adapter. The shared state remains `.devns` JSON, and the shared behavior lives behind DEVNS commands in the target repository. The Codex manifest intentionally does not declare hooks; it declares the plugin identity and skill path, while hook wiring stays as an explicit host/template concern.

## Hook And Provider Boundary

- Stop hooks are triggered by the host client when a turn is about to stop. They are not normal commands for the main agent to call in the middle of work.
- Do not depend on two same-event Stop hooks as a serial pipeline. Review lanes should persist evidence/history first; the DEVNS stop command aggregates persisted state and decides block, allow, or claim-next.
- DEVNS does not ship an LLM provider. It defines JSON contracts for lanes, review findings, and queue decisions so Codex, Claude, local scripts, CI, or humans can act as replaceable workers.
