# DevNS Run

Use this workflow in repositories configured with Never Stop.

1. Read `.devns/devns.config.json`.
2. Read the configured feature inventory.
3. If there are no candidate features, use `devns-init`.
4. If a candidate or feature has no RFC, use `devns-rfc`.
5. Continue the active feature or claim the next ready feature with an approved RFC.
6. Read the approved RFC before editing code.
7. Do technical implementation analysis inside the feature loop.
8. Implement one feature.
9. Run verification and review lanes.
10. Record evidence in the feature JSON.
11. Commit exactly one feature.

DevNS is extension-first: project-local skills, agents, sensors, and hook policies override defaults.
