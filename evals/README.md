# DEVNS Evals

DEVNS evals measure the harness as a controller rather than measuring a coding model directly.

## Tiers

- `t1`: deterministic gate fixtures. These run in CI and treat each gate as a classifier over paired trap/clean cases.
- `t2`: frozen review-result golden fixtures. These run locally and grade whether a review agent's lane-result output is grounded, schema-valid, and calibrated instead of acting as a rubber stamp. Future T2 cases may also use frozen review packets with model adapters.
- `t3`: end-to-end seed repositories. These are intended for nightly or release workflows with pass^k and cost reporting.

## Current CI Surface

Run the deterministic suite:

```sh
npm run devns -- eval run --tier t1 --json
npm run devns -- eval run --tier t2 --json
```

Generate a local report:

```sh
npm run devns -- eval run --all --report evals/out/report.md
```

`evals/out/` is ignored because reports are generated artifacts.

## Adding Cases

Each case must pass `tools/schema/eval-case.schema.json`. Add paired cases whenever possible:

- `*.trap.json`: the harness should block.
- `*.clean.json`: the harness should allow.

Per-mode precision, recall, and F1 are computed from those expected and actual decisions.

## What T1/T2 Protect

T1 and T2 cases are deterministic regression fixtures for the DEVNS control plane. They intentionally model paired clean/trap examples instead of broad unit coverage:

- `M1_domain_drift`: candidate provenance and project-external terminology traps.
- `M2_scope_creep`: implementation-surface scope guard traps.
- `M3_fake_evidence`: independent review and implementer self-stamp traps.
- `M4_evidence_quality`: compatible evidence coverage, fake browser coverage, and missing review-agent coverage traps.
- `M5_review_result_quality`: grounded block/allow review outputs and traps for rubber-stamp allow or ungrounded block outputs.
- `M6_trace_quality`: orchestrator trace structure, claim-event integrity, and prompt/diff/transcript leakage traps.
- `M7_state_reliability`: atomic state write round-trip and temporary state file leakage traps.
- `M8_trace_continuity`: completed feature traces must include handoff, lane/review evidence, and completion in order.
- `M9_artifact_requirements`: semantic browser/human/review evidence must include artifact refs or URLs.
- `M10_artifact_integrity`: browser-smoke artifact refs must resolve to a valid manifest and log files.
- `M11_artifact_content_quality`: rich browser artifacts such as screenshots and structured console/network logs must be parseable.
- `M12_browser_policy_quality`: optional strict browser policies block console errors and failed network requests.
- `M13_browser_policy_budget_allowlist`: browser policies can enforce console/network budgets and URL allow/block lists.
- `M14_project_browser_policy_config`: project config can drive browser artifact policy without per-eval arguments.
- `M15_artifact_digest_review_surface`: browser artifact refs are converted into review-facing digests instead of staying refs-only.
- `M16_dashboard_artifact_preview`: dashboard/browser semantic snapshots must expose artifact digest status, metrics, sample URLs, and policy findings instead of refs-only evidence.
- `M17_browser_semantic_snapshot_ingestion`: browser-smoke manifests can carry DOM, OCR, or accessibility text artifacts that feed the M16 preview grader without hand-written visible text.

This keeps the eval suite focused on the behaviors that make DEVNS trustworthy as an agent harness: intent provenance, scope control, independent review, and evidence that matches the acceptance criterion's verification type.
