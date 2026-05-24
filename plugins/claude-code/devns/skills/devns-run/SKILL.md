---
name: devns-run
description: Use the DevNS harness to claim one feature, analyze requirements, implement, verify, record evidence, and let the Stop hook decide whether to continue or stop.
---

# DevNS Run

Use this skill when working in a repository with DevNS configured.

## Workflow

1. Read `.devns/devns.config.json`.
2. Read the configured feature inventory.
3. If there are no candidate features, use `devns-init` first.
4. If a candidate or feature has no RFC, use `devns-rfc` first.
5. If a feature is `in_progress`, continue that feature.
6. Otherwise claim the highest-priority `ready` feature with an approved RFC.
7. Read the approved RFC before editing code.
8. Do technical implementation analysis inside the feature loop.
9. Implement exactly one feature.
10. Run the configured review and test lanes.
11. Record evidence and execution history into the feature JSON.
12. Create one commit for the feature.
13. Let the Stop hook decide whether to continue, claim the next feature, or stop for human review.

## Rules

- Do not mark a feature `done` without evidence.
- Do not mix multiple feature IDs in one commit.
- Do not claim a new feature while the active feature has unresolved blocking evidence.
- Do not claim or implement a feature without an approved RFC.
- If requirements are ambiguous before implementation, use `devns-rfc`.
