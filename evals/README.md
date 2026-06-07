# DEVNS Evals

DEVNS evals measure the harness as a controller rather than measuring a coding model directly.

## Tiers

- `t1`: deterministic gate fixtures. These run in CI and treat each gate as a classifier over paired trap/clean cases.
- `t2`: frozen review-packet and review-result golden fixtures. These run locally and grade whether a review agent receives enough bounded context, and whether its lane-result output is grounded, schema-valid, and calibrated instead of acting as a rubber stamp. Future T2 cases may add live model adapter calibration on top of these deterministic goldens.
- `t3`: local seed repositories. These run commands inside temporary repositories, verify artifacts, and report pass^k, elapsed time, estimated cost, and failure taxonomy for nightly or release workflows.

## Current CI Surface

Run the deterministic suite:

```sh
npm run devns -- eval run --tier t1 --json
npm run devns -- eval run --tier t2 --json
npm run devns -- eval run --tier t3 --json
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

T1 and T2 cases are deterministic regression fixtures for the DEVNS control plane. T3 cases run seed repositories and classify end-to-end harness failures. All tiers prefer paired clean/trap examples over broad but ungrounded coverage:

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
- `M18_review_packet_quality`: frozen review packets must include approved RFC context, acceptance criteria, Git diff, evidence quality, evidence/artifact digest context, execution history, project rules, and read-only lane-result output instructions.
- `M19_context_budget`: long continuation loops must recommend a fresh worker or compact implementation context once history or stop-hook turn budgets are exceeded.
- `M20_project_extension_config`: project-local policy/agent/lane extension files must merge into resolved config, while schema-invalid policy patches are blocked.
- `M21_worker_repair_trace_continuity`: context-reset traces must include a later worker result, and repair requests must close with a later repair result before completion.
- `M22_t3_seed_repository`: T3 seed repositories run local commands, verify browser-smoke semantic artifacts, and report pass^k, elapsed time, estimated cost, and failure taxonomy.
- `M23_t3_project_shape_seeds`: T3 now includes paired CLI, React/Vite, and Python package seed repositories, covering JSON command contracts, frontend semantic surfaces, package import/contract failures, multi-attempt pass^k, and per-seed project type/risk metadata.

This keeps the eval suite focused on the behaviors that make DEVNS trustworthy as an agent harness: intent provenance, scope control, independent review, and evidence that matches the acceptance criterion's verification type.
