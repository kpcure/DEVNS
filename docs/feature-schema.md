# Feature Schema

The feature inventory is a JSON file referenced by `devns.config.json`.

Default path:

```text
.devns/features.json
```

## Minimal Inventory

```json
{
  "$schema": "../tools/schema/features.schema.json",
  "project": {
    "name": "Example Project",
    "description": "A migration project."
  },
  "features": [
    {
      "id": "EX-001",
      "title": "Implement one feature",
      "description": "Describe the expected behavior.",
      "status": "ready",
      "priority": "P0",
      "milestone": "MVP",
      "risk": "medium",
      "acceptanceCriteria": [
        "The behavior is implemented."
      ]
    }
  ]
}
```

## RFC Gate

A feature can be present in the inventory before it is ready for implementation.

For implementation and automatic claiming, DEVNS treats `ready` as stronger than "has a title and description." A claimable feature should have an approved RFC that clarifies the requirement before coding starts.

The current RFC model is an optional `rfc` object on each feature. Early inventories can omit it, but the core RFC gate will not claim a `ready` feature until its RFC is approved.

Minimal RFC shape:

```json
{
  "rfc": {
    "status": "approved",
    "summary": "Clarify the behavior to implement.",
    "background": "Why this feature is needed.",
    "featureDescription": "What behavior is being implemented.",
    "expectedOutcome": "What should be true after implementation.",
    "goals": ["Behavior users should get"],
    "nonGoals": ["Explicitly out of scope"],
    "requirements": [
      {
        "id": "REQ-001",
        "type": "explicit",
        "statement": "The system must support the expected behavior.",
        "priority": "must"
      }
    ],
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "requirementIds": ["REQ-001"],
        "statement": "The expected behavior is observable and testable."
      }
    ],
    "validationPlan": {
      "dynamic": ["Run the relevant unit or integration tests."],
      "static": ["Review changed files against the requirement scope."]
    },
    "testCases": [
      {
        "id": "TC-001",
        "acceptanceCriteriaIds": ["AC-001"],
        "type": "unit",
        "scenario": "The expected input or state is present.",
        "expected": "The expected behavior occurs."
      }
    ],
    "humanDecision": {
      "status": "approved"
    }
  }
}
```

The intended traceability chain is:

```text
requirement -> acceptance criterion -> test case -> test target
```

This lets agents and review lanes reason from the original requirement to dynamic tests, static checks, and execution evidence.

## Detail Artifacts

The feature inventory should stay compact enough for agents and dashboards to scan quickly. Detailed per-feature artifacts can live in separate files or directories and be linked from the feature record:

```json
{
  "id": "EX-001",
  "artifactRefs": {
    "rfc": ".devns/rfcs/EX-001.json",
    "evidence": ".devns/evidence/EX-001",
    "history": ".devns/history/EX-001.md",
    "review": ".devns/reviews/EX-001.md"
  }
}
```

Use the inventory for queue status, summaries, and links. Use artifact files for full RFC records, lane evidence, execution history, and review packets.

DEVNS writes compact JSON state through the shared atomic JSON writer: data is written to a same-directory temporary file, fsynced, renamed into place, and checked for temporary file leakage in smoke/eval coverage. This protects queue state from partial writes during long agent runs while keeping revision conflict checks in place for stale writers.

## Completion Metadata

Completed features can record two related commit hashes:

- `implementationCommit`: the code/product commit that implemented the feature.
- `metadataCommit`: an optional later commit that only records DEVNS state updates.

The legacy `commit` field remains a compatibility alias for `implementationCommit`. DEVNS uses this split because a code commit cannot include the hash of a metadata commit that has not been created yet.

Use `npm run devns:complete -- --id <feature-id>` after deterministic evidence exists. The command updates status, review decision, Git evidence, durable history, and commit metadata in one state transition.

## Evidence Quality

Evidence should be deterministic where possible: command lanes, tests, build, lint, browser checks, static review, dynamic checks, security scans, or Git evidence. Manual evidence is allowed, but if it is the only evidence DEVNS routes the feature to human review instead of treating it as fully verified.

The built-in `evidence-quality-gate` checks that each feature has acceptance criteria and supporting evidence before completion. Evidence may explicitly declare `coversAcceptanceCriteriaIds`, `coversRequirementIds`, `verificationType`, `actor`, `producedAt`, and `artifactRefs`. Build, lint, and security evidence do not automatically cover product semantics, UI labels, browser behavior, or human-review criteria. Explicit coverage claims still need a compatible `verificationType`; command evidence cannot self-declare coverage for a browser or human-review criterion. Semantic browser/human/review evidence that covers acceptance criteria should include `artifactRefs` or a `url`, so future reviewers can inspect the review packet, browser-smoke run, screenshot, log, or external review record behind the claim. Local browser-smoke `run.json` refs are also checked for a recognizable manifest, referenced stdout/stderr logs, optional rich artifact files, parseable structured console/network logs, and strict policy violations such as console errors or failed requests when those policies are enabled.

Acceptance criteria may also declare `verificationType`:

- `command`
- `static_review`
- `browser_smoke`
- `human_review`
- `review_agent`

Product/UX/domain criteria should use `browser_smoke`, `human_review`, or `review_agent` unless a deterministic test truly verifies the semantic behavior. Detailed matrices belong in history or review packets; the feature inventory keeps only compact evidence summaries.

Changed files can be split into `implementationFiles` and `stateFiles` when completion records both product code and DEVNS metadata. Review surfaces should prioritize implementation files and show state files separately.

## Execution History

History records are JSONL artifacts under `.devns/history/<feature-id>.jsonl`. They are not terminal transcripts. A useful record should preserve the knowledge a future agent needs before touching the same area again:

- `decisions`: why the implementation or verification shape was chosen
- `alternativesRejected`: options considered but not taken, with the reason
- `pitfalls`: reusable warnings, with cause, fix, or prevention when known
- `errors`: concrete mistakes encountered during implementation or validation
- `fixes`: changes that repaired those mistakes
- `lessons`: short guidance future agents should read before continuing
- `dynamicChecks` and `staticChecks`: concise verification summaries
- `laneResults`: optional full structured lane envelopes

The feature inventory should keep only summary/link metadata in `history`. Detailed records stay in the history artifact so dashboard and agent prompts can load them on demand.

## Status Values

- `ready`
- `in_progress`
- `done`
- `blocked`
- `failed`

## Priority Values

- `P0`
- `P1`
- `P2`
- `P3`

## Review Decision Values

- `pending`
- `approved`
- `needs_changes`
- `follow_up`

The JSON schema is in:

```text
tools/schema/features.schema.json
```

Related workspace schemas are:

```text
tools/schema/candidates.schema.json
tools/schema/rfc.schema.json
tools/schema/devns-config.schema.json
```

These schemas are the field contract for agents, the dashboard, hooks, and CLI commands. Unknown fields are intentionally rejected unless a specific extension point is added to the schema.
