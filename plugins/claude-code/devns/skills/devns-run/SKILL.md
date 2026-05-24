---
name: devns-run
description: Use the DevNS harness to claim one feature, analyze requirements, implement, verify, record evidence, and let the Stop hook decide whether to continue or stop.
---

# DevNS Run

Use this skill when working in a repository with DevNS configured.

## Workflow

Start by running the stable command surface:

```sh
npm run devns:run -- --json
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
3. Implement exactly one feature.
4. Run the configured review and test lanes.
5. Record evidence and execution history into the feature JSON.
6. Create one commit for the feature.
7. Let the Stop hook decide whether to continue, claim the next feature, or stop for human review.

## Rules

- Do not mark a feature `done` without evidence.
- Do not mix multiple feature IDs in one commit.
- Do not claim a new feature while the active feature has unresolved blocking evidence.
- Do not claim or implement a feature without an approved RFC.
- If requirements are ambiguous before implementation, use `devns-rfc`.
