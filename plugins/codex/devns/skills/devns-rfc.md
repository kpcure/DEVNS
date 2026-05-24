# DEVNS RFC

Use this skill before a feature can enter the implementation loop.

## Goal

Turn an abstract feature or candidate into a reviewable RFC. The RFC is the requirement model and test oracle for later implementation.

## RFC Must Cover

- Project background relevant to the feature
- Feature description
- Expected outcome
- Goals and non-goals
- Explicit requirements
- Implicit requirements inferred from code, tests, docs, or legacy behavior
- Behavior boundaries and edge cases
- Acceptance criteria
- Validation route
- Test case candidates
- UT / integration / E2E / static check targets
- Unknowns and risks

## Implicit Requirement Checklist

For every RFC, actively check whether the feature implies any hidden requirements around:

- JSON/file schemas and field contracts
- State transitions and ownership
- Human edits versus agent edits
- Validation, migration, and backward compatibility
- Review evidence and audit history
- Concurrency, locking, overwrite, or stale reads
- Extension points and project-local overrides

If any apply, add them as implicit requirements, acceptance criteria, or unknowns. Do not rely only on the feature title.

## Workflow

1. Read the candidate feature or existing feature.
2. If no RFC file exists, create the deterministic scaffold:

```sh
npm run devns:rfc -- scaffold --id <candidate-or-feature-id>
```

3. Read `AGENTS.md`, project rules, `.devns/project.md`, `.devns/index.md`, and the configured feature/candidate inventory.
4. Inspect source references attached to the candidate.
5. Search nearby routes, APIs, schemas, tests, docs, fixtures, and legacy implementation hints.
6. Extract explicit and implicit requirements.
7. Convert requirements into acceptance criteria.
8. Convert acceptance criteria into test case candidates and test targets.
9. Mark test cases that can become unit tests as `type: "unit"`.
10. Record unknowns. Ask at most 3-5 high-impact clarification questions.
11. Update the RFC object with `status: "needs_human_review"` unless blocking unknowns make it `blocked`.
12. If the RFC is already attached to a feature, check gate readiness:

```sh
npm run devns:rfc -- check --id <feature-id>
```

## Readiness Rule

A feature can be claimed only after the RFC is approved by a human and has no blocking unknowns.

CLI commands are the deterministic substrate. The skill owns requirement discovery and judgment; the CLI owns scaffolding, path conventions, and gate checks.

Keep the requirement-to-test chain explicit:

```text
requirement -> acceptance criterion -> test case -> test target
```
