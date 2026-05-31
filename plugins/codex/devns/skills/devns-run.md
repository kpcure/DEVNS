# DEVNS Run

Use this workflow in repositories configured with DEVNS.

If you are unsure what to do, check the workspace first:

```sh
npx @kpcure/devns doctor --json
```

Start by running the stable command surface:

```sh
npx @kpcure/devns run --json
```

Then follow the returned mode:

1. `bootstrap_required`: run `devns-init` before implementation.
2. `continue_active`: continue the active feature only.
3. `claim_next`: read the returned feature and approved RFC before editing code.
4. `blocked_ready`: run `devns-rfc` or ask for human RFC approval.
5. `empty_queue`: stop unless the human adds new candidates or features.

Inside one feature loop:

1. Read the approved RFC and linked context.
2. Do technical implementation analysis before coding.
3. Prefer an isolated worker/subagent or fresh implementation context for the feature when the host supports it.
   The worker receives only the RFC, relevant history, changed-file plan, validation plan, and prompt contracts.
   The main context keeps orchestration state and receives a compact handoff packet with diff, evidence, decisions, pitfalls, and blockers.
4. Implement exactly one feature.
5. Run verification and review lanes.
6. Record evidence and execution history.
7. Commit exactly one feature.

DEVNS is extension-first: project-local skills, agents, sensors, and hook policies override defaults.

## Hook Boundary

- Do not manually run the stop hook as the normal continuation mechanism. Stop hooks are host lifecycle callbacks triggered when the client is about to stop.
- Do not assume two Stop hooks form a serial pipeline. A review step should write lane evidence/history before the final stop attempt; the DEVNS stop command then aggregates that persisted state.
- DEVNS is not an LLM provider. Review agents are optional read-only workers behind lanes, and their portable output is the DEVNS lane-result JSON contract.
