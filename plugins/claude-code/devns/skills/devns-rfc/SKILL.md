---
name: devns-rfc
description: Clarify a DEVNS candidate feature into an RFC with requirements, acceptance criteria, validation plan, and test case candidates before implementation.
---

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

## Clarification Prompt

Use `prompts/rfc-clarification.md` as the detailed prompt contract. In short, clarify:

- intent: actor, problem, expected outcome
- scope: goals, non-goals, explicit boundaries
- domain model: entities, invariants, ownership, lifecycle states
- behavior: happy path, edge cases, invalid inputs, failure modes
- interfaces: CLI, API, UI, JSON schema, file path, hook, lane, plugin, or agent contract
- compatibility: migrations, existing data, backward compatibility, rollback
- operations: concurrency, stale reads, retries, idempotency, long-running work
- validation: dynamic commands, static checks, manual review, evidence artifacts
- review: what a human must see, what a review agent must verify
- knowledge: decisions, pitfalls, errors, fixes, and domain lessons that should be recorded

Questions must be recommendation-first and bounded. Ask at most five, each with one recommended answer, alternatives, owner, and blocking flag.

## Workflow

1. Read the candidate feature or existing feature.
2. If no RFC file exists, create the deterministic scaffold:

```sh
npx @kpcure/devns rfc scaffold --id <candidate-or-feature-id>
```

1. Read `AGENTS.md`, project rules, `.devns/project.md`, `.devns/index.md`, and the configured feature/candidate inventory.
   If a documented npm alias is missing, inspect `package.json` and use the closest available DEVNS command instead of stopping.
2. Inspect source references attached to the candidate.
3. Search nearby routes, APIs, schemas, tests, docs, fixtures, and legacy implementation hints.
4. Extract explicit and implicit requirements.
5. Convert requirements into acceptance criteria.
6. Convert acceptance criteria into test case candidates and test targets.
7. Mark test cases that can become unit tests as `type: "unit"`.
8. Record unknowns. Ask at most 3-5 high-impact clarification questions.
   To generate bounded recommended-option questions from the current RFC state, run:

```sh
npx @kpcure/devns rfc clarify --id <candidate-or-feature-id> --json
```

9. Update the RFC object with `status: "needs_human_review"` unless blocking unknowns make it `blocked`.
10. If the RFC is already attached to a feature, check gate readiness:

```sh
npx @kpcure/devns rfc check --id <feature-id>
```

## Output Shape

```json
{
  "rfc": {
    "status": "needs_human_review",
    "summary": "Short summary",
    "background": "Why this matters",
    "featureDescription": "What should be implemented",
    "expectedOutcome": "What should be true afterward",
    "goals": [],
    "nonGoals": [],
    "requirements": [
      {
        "id": "REQ-001",
        "type": "explicit",
        "statement": "Requirement statement",
        "source": "user/project/code/test",
        "priority": "must"
      }
    ],
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "requirementIds": ["REQ-001"],
        "statement": "Testable acceptance criterion",
        "verification": "How to verify it"
      }
    ],
    "validationPlan": {
      "dynamic": [],
      "static": []
    },
    "testCases": [
      {
        "id": "TC-001",
        "acceptanceCriteriaIds": ["AC-001"],
        "type": "unit",
        "scenario": "Input, state, or action",
        "expected": "Expected result",
        "candidateTestName": "should_do_expected_behavior"
      }
    ],
    "unknowns": [],
    "risks": [],
    "humanDecision": {
      "status": "pending"
    }
  }
}
```

## Readiness Rule

A feature can be claimed only after the RFC is approved by a human and has no blocking unknowns.

CLI commands are the deterministic substrate. The skill owns requirement discovery and judgment; the CLI owns scaffolding, path conventions, and gate checks.

## Rules

- Do not implement code while running this skill.
- Do not hide ambiguity. Put unresolved questions in `unknowns`.
- Do not include detailed implementation file edits; those belong in the implementation loop.
- Keep the requirement-to-test chain explicit:

```text
requirement -> acceptance criterion -> test case -> test target
```
