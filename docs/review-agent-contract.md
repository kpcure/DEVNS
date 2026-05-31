# Review Agent Contract

Review agents are read-only workers behind DEVNS review lanes. They inspect requirements, diffs, evidence, and project rules, then return structured findings. They do not edit files, install packages, run formatters, or create commits.

## Boundary

DEVNS is not an LLM provider and does not require a specific agent runtime.

A review worker can be:

- a Claude Code subagent or agent hook
- a Codex task or script
- a local static analyzer
- a CI job
- a human review form

The stable DEVNS contract is the lane result JSON, not the worker implementation.

## Codex-Style Review Lane

A review agent should not receive only a feature title. Build a review packet first, then ask for structured findings.

The concrete prompt template lives at `plugins/codex/devns/prompts/code-review-lane.md`. Host-specific adapters may copy it, but must keep the same read-only boundary and lane-result output.

Generate the packet with:

```sh
npm run devns:review -- packet --feature <feature-id> --format prompt --write
```

This writes `.devns/reviews/packets/<feature-id>.review-packet.json` and, for prompt format, `.devns/reviews/packets/<feature-id>.review-prompt.md`.

Required packet sections:

- active feature ID, RFC summary, requirements, acceptance criteria, and validation plan
- changed files from Git
- unified Git diff for the current feature, bounded to a configured size
- static and dynamic command results already run by lanes
- relevant history lessons, pitfalls, and prior errors for touched files or feature area
- project rules from `AGENTS.md`, `.devns/index.md`, and local policy overrides

The worker prompt should ask for findings first, focused on bugs, regressions, requirement mismatches, missing tests, unsafe behavior, and unverifiable claims. Every blocking finding needs a concrete file/line when available, evidence from the diff or command output, confidence, severity, and a suggested fix. If no actionable issue exists, the worker should say that explicitly and still report residual test gaps.

This mirrors the Codex code-review shape: assemble PR/change context and diff, run in read-only mode, and require machine-readable findings rather than free-form prose.

## Findings

Each finding should include as much of the following as possible:

- `severity`: `info`, `warning`, or `error`
- `category`: correctness, security, scope, test, maintainability, or reviewability
- `confidence`: low, medium, or high
- `file` and `line`
- `requirementIds`
- `evidence`
- `suggestedFix`

Only high-severity, high-confidence, evidence-backed findings should block completion. Low-confidence findings route to human review.

## Stop Hook Shape

Do not model review and queue claiming as two same-event `Stop` hooks where the second hook reads the first hook's output. Hosts may run matching hooks independently, so that shape is not portable.

DEVNS uses one host-neutral stop command as an orchestrator. It reads persisted lane/review evidence, decides whether to block or allow stopping, and claims the next approved feature when policy requires continuation.

Provider-specific agent hooks may be installed as optional producers of lane evidence. They should write or return the same lane result shape that command and builtin lanes use.

Long-running review should happen before the final stop attempt:

1. Main agent finishes the feature implementation.
2. Command lanes run static and dynamic verification.
3. Optional review-agent lane reads the Git diff plus RFC/history/evidence and writes a lane result.
4. The Stop hook reads persisted lane evidence and decides whether to block, allow, or claim the next feature.

## Agent Instructions For Plugins

If you are an agent using a DEVNS plugin:

- Continue work through `devns-run`, feature RFCs, lanes, and commits.
- Let the host trigger Stop hooks naturally at the end of a turn.
- Do not call the Stop hook manually except for explicit smoke tests or debugging.
- Do not assume DEVNS owns Claude, Codex, OpenAI Agents SDK, or any other provider runtime.
- Treat provider-specific review agents as adapters that must obey the same read-only lane-result contract.
