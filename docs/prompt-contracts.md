# DEVNS Prompt Contracts

These contracts are the prompt-level part of DEVNS. Commands and JSON schemas make the harness deterministic; these prompts make agent judgment repeatable.

## Stop Hook Continuation

The Stop hook is a lifecycle gate and safety net, not the implementation worker and not the normal queue loop. It should read persisted state and return one concise instruction packet. It may run configured missing read-only Review Agent lanes, but those lanes must receive a bounded packet and return lane-result JSON instead of editing files or continuing implementation.

The continuation packet should include:

- current mode: continue active feature, repair evidence, commit completed feature, claim next feature, or stop for human review
- feature id and title
- blocking reason, with the exact missing gate when possible
- next command or document to read
- for claim-next, a worker handoff that tells the host to start a Sub Agent, isolated worker, or fresh implementation context before editing
- required evidence to write before the next stop attempt
- when `completionPolicy.contextBudget` is exceeded, a compact-handoff instruction that tells the host to start a fresh worker/context and rebuild from RFC, feature state, history, and evidence on disk

It must not ask the agent to run broad discovery, long tests, browser checks, package installs, or arbitrary project commands inside the hook. Those are lanes that should finish before the stop attempt. Review Agent work is allowed only through configured `type: "agent"` lanes with a read-only adapter and structured output.

## Feature Worker Handoff

After RFC clarification and before implementation, use Orchestrator Mode when the host supports it. The main agent keeps queue/evidence/review/commit responsibility and launches an isolated worker/subagent or fresh implementation context for one feature. This prevents one long context from accumulating every feature's details.

Worker input:

- one feature id and approved RFC
- relevant history decisions, pitfalls, errors, fixes, and lessons
- allowed changed-file plan and non-goals
- validation plan and required lanes
- code review and domain knowledge prompt contracts

Worker output:

- changed files and diff summary
- commands run and lane evidence
- decisions, alternatives rejected, pitfalls, errors, fixes, lessons
- blockers or human-review questions
- suggested commit message

The normal orchestrator prompt should not ask the main context to implement directly. It should instruct the host to start a Sub Agent, isolated worker, or fresh implementation context with the worker handoff. The main context should keep queue orchestration, evidence aggregation, review routing, completion, and commits. The worker should implement exactly one feature.

When `contextBudget.resetRecommended` is true, the main context should not keep repairing inside the same accumulated conversation. Start a fresh worker/context, keep the static instructions first, and pass only the bounded handoff plus links to durable history and artifacts.

## Code Review Lane

The review worker is read-only. It reviews one feature against one diff and returns one lane-result JSON object.

Inputs:

- approved RFC: summary, requirements, acceptance criteria, validation plan, non-goals, risks
- feature record: status, changed files, evidence, review decision, commit metadata
- Git context: base/head when available, `git status --short`, changed files, bounded unified diff
- static and dynamic lane results
- relevant history: decisions, rejected alternatives, pitfalls, errors, fixes, lessons
- local rules: `AGENTS.md`, `.devns/index.md`, `.devns/policies/`

Review order:

1. Check scope: every changed file should map to RFC goals, acceptance criteria, validation, or necessary infrastructure.
2. Check correctness and regressions from the diff.
3. Check requirement coverage and missing tests.
4. Check evidence quality: commands, artifacts, and manual assertions must support the acceptance criteria.
5. Check security, data loss, compatibility, migration, concurrency, and human override risks.
6. Produce findings only when they are actionable and evidence-backed.

Output rules:

- Findings first, ordered by severity.
- Each blocking finding needs file/line when available, evidence from diff or command output, confidence, and suggested fix.
- High severity plus high confidence may return `decision: "block"`.
- Low confidence, ambiguous ownership, or missing context returns `decision: "needs_human_review"`.
- No issues returns `decision: "allow"` and still states residual test gaps.

## RFC Clarification

Clarification turns a feature idea into an implementation oracle. It must ask what matters before coding, not after.

Question areas:

- intent: user/project problem, actor, job-to-be-done
- scope: goals, non-goals, boundaries, out-of-scope tempting work
- domain model: entities, invariants, lifecycle states, ownership
- interfaces: commands, APIs, UI surfaces, JSON/schema contracts, file paths
- behavior: happy path, edge cases, failure modes, permissions
- compatibility: migration, existing data, backward compatibility, rollback
- validation: unit/integration/e2e/static/manual evidence and blocking lanes
- review: evidence that humans need, risk class, history knowledge to preserve
- operations: concurrency, stale reads, retries, idempotency, long-running tasks

Questions should be bounded and choice-based. Prefer one recommended option plus alternatives, and mark whether the answer blocks implementation.

## Domain Knowledge Curator

History is not a changelog. It is project memory for future agents.

Record:

- decisions and why they were chosen
- alternatives rejected and why
- pitfalls and how to avoid them
- errors encountered and concrete fixes
- domain invariants and file-specific constraints
- validation commands that actually prove behavior
- follow-ups and unresolved risks

Avoid:

- long terminal transcripts
- generic "implemented X" summaries without rationale
- repeating the RFC when no new knowledge was learned
- hiding uncertainty or failed attempts
