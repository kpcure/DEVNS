# Configuration

DEVNS configuration lives in:

```text
.devns/devns.config.json
```

## Minimal Config

```json
{
  "$schema": "../tools/schema/devns-config.schema.json",
  "version": 1,
  "features": ".devns/features.json",
  "candidates": ".devns/candidates.json",
  "rfcs": ".devns/rfcs",
  "history": ".devns/history",
  "traces": ".devns/traces",
  "policies": ".devns/policies",
  "skills": {
    "init": "devns-init",
    "rfc": "devns-rfc",
    "run": "devns-run"
  }
}
```

## Workspace Files

- `features`: executable feature queue. The run loop only claims items with approved RFCs.
- `candidates`: discovered work that still needs human confirmation or RFC clarification.
- `rfcs`: directory for RFC records and future per-feature RFC files.
- `history`: execution history, impact summaries, and evidence records.
- `traces`: local JSONL traces for orchestrator and harness workflow decisions.
- `policies`: project-local harness policies.
- `skills`: host-visible skill names or project-local skill overrides.

## Stop Hook

```json
{
  "hooks": {
    "stop": {
      "mode": "gate",
      "retryBudget": 3,
      "defaultDecision": "stop_for_human_review",
      "reviewAgent": {
        "mode": "run_missing",
        "laneIds": ["code-review"],
        "requireDeterministicEvidence": false
      }
    }
  }
}
```

`reviewAgent.mode = "run_missing"` lets the Stop Hook safety gate run configured missing read-only `type: "agent"` lanes before returning its final decision. Set it to `"off"` when review must only happen through Orchestrator Mode before the stop attempt.

## Review Lanes

Review lanes are evidence-producing checks used by the Stop hook.

```json
{
  "reviewLanes": [
    {
      "id": "deterministic-checks",
      "type": "command",
      "command": "npm test",
      "required": true,
      "blocksCompletion": true
    }
  ]
}
```

Supported lane types planned for the core:

- `command`
- `agent`
- `builtin`

Command lanes produce a structured result envelope with command, exit code, duration, stdout/stderr digests, findings, evidence, and a decision. Required blocking failures return `block`; nonblocking failures return `warn` so legacy lint or low-confidence security findings can be reviewed without pretending they are absolute proof. Agent lanes may run an external command that returns lane-result JSON. Project-local lane files in `.devns/lanes/*.json` are merged into `reviewLanes`.

`devns:init` seeds lanes from detected package scripts:

- `test`, `typecheck`, and `build` are required blocking command lanes when present.
- `lint` is nonblocking by default because existing projects often carry legacy lint debt.
- `security_basic` is a builtin lightweight secret/config-change scanner and starts as nonblocking risk evidence.

Browser smoke checks are project-specific because teams use different browser runners. `devns init` installs `.devns/adapters/browser-smoke.sh`; copy `templates/devns/lanes/browser-smoke.json` into `.devns/lanes/browser-smoke.json` and replace `DEVNS_BROWSER_SMOKE_COMMAND` with the project command, such as `npx playwright test` or `npm run e2e`. The adapter emits `DEVNS_ARTIFACT=...` lines that command lanes capture as artifact refs.

The config schema is fixed in:

```text
tools/schema/devns-config.schema.json
```

Project-specific behavior should be added through declared extension points such as `skills`, `agents`, `reviewLanes`, and `policies`, not by adding arbitrary top-level fields.

## Context Budget

Long stop-hook continuation loops should avoid carrying an ever-growing context. `completionPolicy.contextBudget` gives agents and hooks a shared hint:

```json
{
  "completionPolicy": {
    "contextBudget": {
      "maxContinuationTurns": 10,
      "preferFreshWorkerPerFeature": true,
      "handoffTokenBudget": 2000,
      "resetWhenHistoryRecordsExceed": 20
    }
  }
}
```

The current runtime exposes this in `devns orchestrate --json` handoff. Hosts can use it to start a fresh worker/subagent per feature while keeping detailed history in `.devns/history/`.

## Local Traces

`traces` defaults to `.devns/traces`. `devns orchestrate` appends one bounded JSONL record to `.devns/traces/orchestrator.jsonl` for each workspace decision. The record includes mode, host, selected feature, claim status, subagent names, reasons, events, and next-step labels. It intentionally does not store generated prompts, diffs, model transcripts, stdout, or stderr. Use `devns trace --audit` to inspect recent records.
