# Roadmap

## 1.0 Hardening

- Close the review evidence loop with `devns evidence add`, `devns lanes ingest`, and auditable completion overrides.
- Keep discovery and RFC clarification grounded in project sources rather than built-in demo domains.
- Make review packets useful before and after implementation commits.
- Show browser-smoke artifact digests directly in the review dashboard, not only in JSON/Markdown reports.
- Add CI, governance docs, and stable first-run documentation.
- Keep hardening decisions grounded in `docs/solidification-analysis.zh-CN.md`.

## Next

- Add focused unit and golden tests around evidence quality, review packets, RFC clarification, and queue state.
- Add UI screenshot semantic graders for browser smoke artifacts and dashboard previews.
- Expand project extension wiring for policies, agents, and lanes.
- Add context-budget policy support for long stop-hook continuation loops.
- Expand evals from T2 frozen review-result golden checks, M6/M8 trace checks, M7 state-reliability checks, M9 artifact requirements, M10 artifact integrity, M11 rich artifact parseability, M12 basic browser policy graders, M13 browser policy budgets/URL lists, M14 project-configured browser policies, and M15 artifact digests into frozen review packets, adapter calibration, worker/repair trace continuity, UI screenshot semantic graders, and T3 seed repositories.
