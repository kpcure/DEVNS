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

- Add focused unit and golden tests around evidence quality, live review adapter calibration, RFC clarification, and queue state.
- Expand T3 seed repositories beyond the browser-smoke, CLI, React/Vite, and Python package seeds into Next and host-adapter scenarios.
- Calibrate real host adapters against the resolved project policy/agent/lanes registry.
- Connect worker/repair trace continuity to real host adapter and T3 seed-repository failure classification.
- Expand evals from T2 frozen review-result and review-packet golden checks, M6/M8 trace checks, M7 state-reliability checks, M9 artifact requirements, M10 artifact integrity, M11 rich artifact parseability, M12 basic browser policy graders, M13 browser policy budgets/URL lists, M14 project-configured browser policies, M15 artifact digests, M16 dashboard artifact previews, M17 browser semantic snapshots, M19 context-budget checks, M20 project extension config checks, M21 worker/repair trace checks, M22 browser-smoke T3 checks, M23 multi-shape T3 checks, JSONL/Markdown/dashboard/morning-review T3 trend reporting, and release/nightly trend gates into live adapter calibration and real browser command templates.
