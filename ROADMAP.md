# Roadmap

## 1.0 Hardening

- Close the review evidence loop with `devns evidence add`, `devns lanes ingest`, and auditable completion overrides.
- Keep discovery and RFC clarification grounded in project sources rather than built-in demo domains.
- Make review packets useful before and after implementation commits.
- Show browser-smoke artifact digests directly in the review dashboard, not only in JSON/Markdown reports.
- Grade dashboard artifact previews from DOM/text snapshots so refs-only evidence is blocked.
- Ingest browser-smoke DOM/OCR/accessibility snapshot artifacts into dashboard artifact preview grading.
- Add CI, governance docs, and stable first-run documentation.
- Keep hardening decisions grounded in `docs/solidification-analysis.zh-CN.md`.

## Next

- Add focused unit and golden tests around evidence quality, review packets, RFC clarification, and queue state.
- Add real project browser command templates and T3 seed repositories that emit DOM/OCR/accessibility snapshots.
- Expand project extension wiring for policies, agents, and lanes.
- Add context-budget policy support for long stop-hook continuation loops.
- Expand evals from T2 frozen review-result golden checks, M6/M8 trace checks, M7 state-reliability checks, M9 artifact requirements, M10 artifact integrity, M11 rich artifact parseability, M12 basic browser policy graders, M13 browser policy budgets/URL lists, M14 project-configured browser policies, M15 artifact digests, M16 dashboard artifact previews, and M17 browser semantic snapshots into frozen review packets, adapter calibration, worker/repair trace continuity, real browser command templates, and T3 seed repositories.
