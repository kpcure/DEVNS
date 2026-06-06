# Changelog

## Unreleased

- Hardened evidence quality checks so explicit coverage claims must match the required verification type.
- Added deterministic T1 eval coverage for evidence-quality clean/trap cases.
- Added deterministic T2 review-result golden evals for grounded review outputs and rubber-stamp traps.
- Added bounded local orchestrator traces under `.devns/traces/orchestrator.jsonl`.
- Added `devns trace` plus M6 trace-quality evals for orchestrator trace audits.
- Hardened atomic JSON state writes with random temp files, fsync, cleanup, and M7 state reliability evals.
- Added a browser smoke adapter/template that records browser command artifacts through command-lane artifact markers.
- Surfaced evidence artifact refs in morning review JSON, Markdown, and the dashboard review dialog.
- Documented the post-1.0 solidification analysis and eval/subagent hardening strategy.
- Added CLI support for recording evidence and ingesting lane-result review output.
- Added review packet support for explicit `--commit` and `--base` ranges.
- Removed dogfood/demo domain assumptions from core discovery, RFC clarification, and run handoff behavior.
- Added CI and open-source governance documents.
