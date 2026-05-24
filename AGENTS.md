# Agent Operating Protocol

This file defines how an autonomous coding agent should work inside a Never Stop project.

## Mission

Complete one feature at a time, verify it, commit it, record evidence, and continue until no claimable tasks remain.

## Sources Of Truth

- Feature inventory: `examples/mission-migration-dashboard/features.json`
- Background notes: project-specific Markdown files under the task directory
- Human review UI: `web/index.html`
- Git history: one completed feature per commit

## Task Loop

1. Read the feature inventory.
2. Pick the highest-priority task with status `ready`.
3. Change its status to `in_progress` and add a short agent note.
4. Read all linked context files before editing code.
5. Implement the feature with the smallest coherent change.
6. Run the verification commands listed on the task.
7. Update the task with evidence, changed files, risks, and final status.
8. Create one Git commit for exactly that feature.
9. Stop only when there are no `ready` tasks, verification fails, or human input is required.

## Commit Rules

- One feature per commit.
- Commit message format: `<feature id>: <short behavior summary>`
- Do not mix refactors, cleanup, or unrelated fixes into a feature commit.
- If a prerequisite is missing, create or update a blocker note instead of guessing.

## Verification Rules

A task can be marked `done` only when:

- All acceptance criteria are addressed.
- Listed verification commands pass.
- Any skipped verification is explicitly recorded with a reason.
- Risks and follow-up items are written into the task record.

## Review Evidence

For every completed task, record:

- Behavior summary
- Acceptance criteria status
- Test commands and results
- Important files changed
- Known risks
- Screenshots or report links when relevant

