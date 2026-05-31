# DEVNS Evals

DEVNS evals measure the harness as a controller rather than measuring a coding model directly.

## Tiers

- `t1`: deterministic gate fixtures. These run in CI and treat each gate as a classifier over paired trap/clean cases.
- `t2`: frozen review packets with injected bugs. These are intended for reviewer adapter calibration when a model key is available.
- `t3`: end-to-end seed repositories. These are intended for nightly or release workflows with pass^k and cost reporting.

## Current CI Surface

Run the deterministic suite:

```sh
npm run devns -- eval run --tier t1 --json
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
