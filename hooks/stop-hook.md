# Stop Hook Reference

This is a reference behavior for a coding-agent stop hook, inspired by Claude Code's `Stop` hook model and the Ralph Loop plugin pattern.

## Trigger

Run when the host client is about to stop after an agent turn.

The hook is not just a cleanup script. It is a gate that decides whether the agent may stop, must continue the current task, should commit and move to the next task, or must hand control back to a human.

The hook itself must stay lightweight. It reads persisted DEVNS JSON state and concise evidence; it does not run long tests, browser automation, package installs, or LLM review. Those jobs must run before the final stop attempt and write lane evidence/history for the hook to inspect.

## Steps

1. Read `AGENTS.md`.
2. Read the active task from the feature inventory.
3. Confirm that requirement analysis has been completed when required by policy.
4. Read existing lane evidence and execution history.
5. Optionally inspect lightweight git state when policy requires a clean worktree.
6. Evaluate the result with the hook decision model below.

## Decision Model

### Continue Current Task

Use when the task is not complete but the next action is clear.

Examples:

- tests failed with a direct implementation error
- review agent found fixable issues
- acceptance criteria are partially complete
- formatting, typecheck, or lint failed

Hook behavior:

- return a blocking response to the agent
- include a concise continuation prompt
- preserve the active task claim
- do not commit

Continuation prompt shape:

```text
The current feature is not complete. Continue working on <feature-id>.

Blocking evidence:
- <failed command or review finding>

Required next actions:
- <specific fix>
- rerun <verification command>

Do not claim a new task until this feature passes the gate.
```

### Complete Feature And Claim Next

Use when all configured gates pass.

Hook behavior:

1. update task status to `done`
2. write evidence into the task
3. write changed files and risk notes
4. create one Git commit for the feature
5. refresh the HTML dashboard or report data
6. claim the next ready task
7. return a continuation prompt for the next task

Next-task prompt shape:

```text
Feature <completed-feature-id> passed verification and was committed.

Next feature: <next-feature-id> - <title>

Before coding, run the requirement analysis step and update discovered requirements.
```

### Stop For Human Review

Use when automated continuation would be unsafe.

Examples:

- requirement ambiguity
- review agent confidence is low
- high-severity finding without an obvious fix
- skipped required verification
- merge conflict or dirty unrelated files
- repeated failed attempts exceed retry budget

Hook behavior:

- update task status to `blocked` or `failed`
- write evidence and reason
- do not commit unless explicitly configured
- refresh the HTML report
- allow the agent session to stop

### Stop Because Queue Is Empty

Use when no claimable task remains.

Hook behavior:

- refresh the HTML dashboard or morning report
- summarize completed, blocked, and failed work
- allow stop

## Gates

A task may be completed only when all required gates pass:

- requirement analysis gate
- acceptance criteria gate
- deterministic checks gate
- test selection gate
- code review gate
- scope guard gate
- security sensor gate
- reviewability gate
- changed-files scope gate
- Git cleanliness gate
- evidence persistence gate

Projects can configure thresholds, but the default should be conservative:

- high-severity review finding blocks completion
- missing, skipped, blocking, or human-review required lane evidence blocks completion
- low review confidence blocks completion for P0/P1 or high-risk tasks
- changed files outside the declared affected surfaces require human review

## Review And Test Lanes

Default lanes:

- deterministic checks
- test selection agent
- code review agent
- scope guard
- security and secrets sensor
- human reviewability gate

Each lane emits:

- status
- summary
- confidence
- findings
- evidence
- recommended actions
- whether it blocks completion

The Stop Hook should aggregate all lane outputs before deciding whether to continue, complete, or stop for human review.

## Guardrails

- Never mark a task done without verification evidence.
- Never create a commit that spans multiple feature ids.
- Never silently skip tests.
- Never overwrite human review decisions.
- Prefer stopping over guessing when acceptance criteria are ambiguous.
- Never loop indefinitely; enforce a retry budget per task.
- Never claim the next task while the current task has unresolved blocking evidence.

## Why This Differs From Ralph Loop

Ralph Loop is optimized for keeping Claude Code on one prompt until the task is finished.

DEVNS is queue-aware:

- it works across a feature inventory
- it requires structured evidence
- it can move to the next task after a passing commit
- it distinguishes repairable failures from human-review blockers
- it records every decision into the human HTML review plane
