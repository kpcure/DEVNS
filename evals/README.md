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

This keeps the eval suite focused on the behaviors that make DEVNS trustworthy as an agent harness: intent provenance, scope control, independent review, and evidence that matches the acceptance criterion's verification type.
