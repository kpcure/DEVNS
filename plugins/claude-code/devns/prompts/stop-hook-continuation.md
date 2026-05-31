# DEVNS Stop Hook Continuation Prompt

The Stop hook is called by the host when an agent turn is about to stop. The hook does not do the work. It returns a small continuation instruction when DEVNS state says work is not complete.

## Input Signals

- hook input: cwd, hook_event_name, stop_hook_active
- DEVNS config and completion policy
- active feature, if any
- next claimable feature, if any
- RFC readiness
- required lane evidence
- review decision
- commit metadata
- worktree status when configured

## Output Modes

### Continue Active Feature

Use when a feature is `in_progress` and gates are missing.

```text
Continue <feature-id>: <title>.
Blocker: <missing gate or failing evidence>.
Read: <RFC/history/review path>.
Do next: <specific command or implementation step>.
Before stopping again: run lanes, update evidence/history, record review decision, and commit exactly this feature.
```

### Repair Verification

Use when implementation exists but evidence is missing or failed.

```text
Repair verification for <feature-id>.
Missing or failing lane: <lane id>.
Run or inspect: <command/artifact>.
Write: concise evidence in features.json and full output in .devns/history/.
```

### Commit Completed Feature

Use when evidence and review are present but commit metadata is missing.

```text
Commit <feature-id> with explicit files only.
Files: <declared changedFiles>.
Then record commit hash and allow the next stop attempt.
```

### Claim Next Feature

Use when no feature is active and a ready feature has an approved RFC.

```text
Claimed next feature <feature-id>: <title>.
Read its RFC, context, and relevant history before editing.
Run requirement analysis before coding.
Implement one feature only, verify, write evidence/history, and commit.
```

### Stop For Human Review

Use when no claimable work remains, state is invalid, or a human decision is required.

```text
Stop for human review.
Reason: <invalid state, missing human decision, low-confidence review, or empty queue>.
Human action: <approve RFC, inspect review packet, resolve conflict, or add candidates>.
```

## Hard Rules

- If `stop_hook_active` is true, allow stop to avoid recursion.
- Do not run long tests, browser checks, installs, formatters, or LLM review inside the Stop hook.
- Do not assume multiple same-event Stop hooks run in order.
- Do not overwrite human decisions.
- Do not claim more than one feature unless a future policy explicitly allows it.
