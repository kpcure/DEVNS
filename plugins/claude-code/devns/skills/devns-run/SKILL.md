---
name: devns-run
description: Use the DEVNS harness to claim one feature, analyze requirements, implement, verify, record evidence, and let the Stop hook decide whether to continue or stop.
---

# DEVNS Run

Use this skill when working in a repository with DEVNS configured.

If you are unsure what to do, check the workspace first:

```sh
npx devns doctor --json
```

## Workflow

Start by running the stable command surface:

```sh
npx devns run --json
```

Then follow the returned mode:

1. `bootstrap_required`: run `devns-init` first.
2. `continue_active`: continue the active feature only.
3. `claim_next`: read the returned feature and approved RFC before editing code.
4. `blocked_ready`: run `devns-rfc` or ask for human RFC approval.
5. `empty_queue`: stop unless the human adds new candidates or features.

Inside one feature loop:

1. Read the approved RFC and linked context.
2. Do technical implementation analysis inside the feature loop.
3. Prefer an isolated worker/subagent or fresh implementation context for the feature when the host supports it.
   The worker receives only the RFC, relevant history, changed-file plan, validation plan, and prompt contracts.
   The main context keeps orchestration state and receives a compact handoff packet with diff, evidence, decisions, pitfalls, and blockers.
4. Implement exactly one feature.
5. Run the configured review and test lanes.
6. Record evidence and execution history into the feature JSON.
7. Create one commit for the feature.
8. Let the Stop hook decide whether to continue, claim the next feature, or stop for human review.

## Rules

- Do not mark a feature `done` without evidence.
- Do not mix multiple feature IDs in one commit.
- Do not claim a new feature while the active feature has unresolved blocking evidence.
- Do not claim or implement a feature without an approved RFC.
- If requirements are ambiguous before implementation, use `devns-rfc`.
- Do not manually run the Stop hook as the normal continuation mechanism. Stop hooks are host lifecycle callbacks triggered when Claude Code is about to stop.
- Do not assume two Stop hooks form a serial pipeline. Review workers should write lane evidence/history before the final stop attempt; the DEVNS stop command then aggregates persisted state.
- DEVNS is not an LLM provider. Review agents are optional read-only workers behind lanes, and their portable output is the DEVNS lane-result JSON contract.
