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

Browser smoke checks are project-specific because teams use different browser runners. `devns init` installs `.devns/lanes/browser-smoke.json`, `.devns/adapters/browser-smoke.sh`, and `.devns/adapters/playwright-semantic-smoke.mjs`. The lane is optional and inert until `DEVNS_BROWSER_SMOKE_URL` is set; then it runs the Playwright semantic helper through the browser-smoke adapter. The helper writes screenshot, trace, console, network, visible text, DOM HTML, and accessibility/ARIA text artifacts when Playwright is available. Replace the lane command with the project's existing Playwright, Cypress, or browser script when that script already emits richer artifacts. The adapter emits `DEVNS_ARTIFACT=...` lines that command lanes capture as artifact refs.

## Artifact Integrity

Project-level browser artifact policy lives under `artifactIntegrity.browserSmoke`:

```json
{
  "artifactIntegrity": {
    "browserSmoke": {
      "requireRichBrowserArtifacts": true,
      "failOnConsoleError": true,
      "consoleErrorBudget": 0,
      "failOnNetworkError": true,
      "networkFailureBudget": 0,
      "networkFailureStatus": 500,
      "networkAllowedUrls": ["http://127.0.0.1/*"],
      "networkBlockedUrls": ["https://analytics.example.com/*"]
    }
  }
}
```

`devns validate` applies this policy to browser-smoke `run.json` artifact refs. URL patterns support exact/substring matching and `*` wildcards. Keep budgets explicit when the project intentionally tolerates known development noise; otherwise prefer zero-budget policies.

Review packets and morning review reports reuse the same browser-smoke artifact refs to produce artifact digests: exit code, rich artifact counts, screenshot/trace counts, console entry/error counts, network request/failure counts, sample URLs, and policy findings. This keeps human and review-agent surfaces inspectable without requiring readers to manually open every `run.json` first.

Browser lanes can also write semantic text artifacts into the same artifact directory. The adapter recognizes DOM text, accessibility-tree text, ARIA YAML, and OCR text files such as `visible-text.txt`, `dom-snapshot.html`, `accessibility.json`, `accessibility.aria.yml`, and `ocr.txt` as `dom_snapshot`, `accessibility_snapshot`, and `ocr_text`. The `dashboard_artifact_preview` eval gate can read those artifacts from `run.json` and verify that dashboard/browser previews expose artifact digest status, metrics, sample URLs, and policy findings rather than refs-only evidence.

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

The runtime now evaluates this policy in both Orchestrator Mode and the Stop Hook safety gate. `devns orchestrate --json` includes a `contextBudget` report with history record counts, stop-hook continuation counts, whether a compact handoff is recommended, and a bounded handoff instruction. When an active feature is blocked and the policy threshold is exceeded, the Stop Hook continuation reason explicitly asks the host to reset to a fresh worker or compact implementation context and to rebuild context from the RFC, feature record, latest history, and lane/review evidence on disk.

This follows the same shape as trace-context propagation: carry the identifiers and bounded state needed to continue the workflow, and keep detailed history/artifacts in durable local files rather than pasting the whole transcript forward.

## Local Traces

`traces` defaults to `.devns/traces`. `devns orchestrate` appends one bounded JSONL record to `.devns/traces/orchestrator.jsonl` for each workspace decision. The record includes mode, host, selected feature, claim status, subagent names, reasons, events, and next-step labels. It intentionally does not store generated prompts, diffs, model transcripts, stdout, or stderr. Use `devns trace --audit` to inspect recent records.
