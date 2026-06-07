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

In normal automation, `devns lanes run --feature <feature-id> --write --json` does this for `type: "agent"` lanes before invoking the configured adapter. Host init can install a lane like:

```json
{
  "id": "code-review",
  "type": "agent",
  "agent": "codex-review",
  "command": "bash .devns/adapters/code-review.codex.sh",
  "required": true,
  "blocksCompletion": true
}
```

The Codex adapter reads `DEVNS_REVIEW_PROMPT`, runs `codex exec` in read-only mode, captures the final message, and prints one lane-result JSON object to stdout. It sets `DEVNS_STOP_COMMAND=true` for the nested Codex process so the review worker does not recursively trigger the project Stop hook.

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

Review-agent packet input and output can be regression-tested without invoking a model:

```sh
npm run devns -- eval run --tier t2 --mode M5_review_result_quality --json
npm run devns -- eval run --mode M18_review_packet_quality --json
```

T2 frozen review-packet cases grade whether a packet contains approved RFC context, acceptance criteria, Git diff, evidence quality, evidence/artifact digests, execution history, project rules, and read-only lane-result output instructions. T2 frozen review-result cases grade whether a `lane-result` is schema-valid, grounded, calibrated, and non-rubber-stamp. A valid blocking review must include high-confidence, evidence-backed error findings with file/line grounding. A valid allow review must include review context evidence or artifacts and recommended follow-up text for residual test gaps or an explicit no-action statement.

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

DEVNS uses one logical Stop Hook safety gate. In Claude Code that gate can be a `type: "agent"` hook prompt; in Codex it is currently a command adapter. The gate reads persisted lane/review evidence and decides whether stopping is safe.

Provider-specific agents may be installed as implementation workers, review workers, or safety-net hook agents. They should write or return the same lane result shape that command and builtin lanes use.

Review work can happen in two safe places:

1. Before the final stop attempt, through `devns lanes run --feature <id> --write --json`.
2. In Orchestrator Mode, where the main agent explicitly launches the review subagent and ingests the result.
3. Inside the Stop Hook safety gate, only as a fallback for configured missing read-only agent lanes such as `code-review`.
4. In Claude Code's agent-hook fallback mode, where the Stop hook agent can generate the review packet, perform the review, ingest one lane-result JSON object, and then translate the final DEVNS decision to Claude's `ok` schema.

The second mode is controlled by:

```json
{
  "hooks": {
    "stop": {
      "reviewAgent": {
        "mode": "run_missing",
        "laneIds": ["code-review"],
        "requireDeterministicEvidence": false
      }
    }
  }
}
```

When this mode runs, the Stop Hook first executes the missing Review Agent lane, writes lane evidence and feature history, updates the feature review decision from the structured lane result, and then makes one final block/allow/claim decision from the updated state.

The preferred explicit flow is still:

1. Main agent finishes the feature implementation.
2. Command lanes run static and dynamic verification.
3. Optional review-agent lane reads the Git diff plus RFC/history/evidence and writes a lane result.
4. The Stop hook reads persisted lane evidence and decides whether to block, allow, or claim the next feature.

The Stop hook should not rely on two same-event hooks running serially. If review-agent evidence is missing and hook-run review is disabled, the orchestrator returns a block reason telling the host/main agent to run lanes first; the lane runner then invokes the review worker and persists the result for the next Stop hook decision.

## Agent Instructions For Plugins

If you are an agent using a DEVNS plugin:

- Continue work through `devns-run`, feature RFCs, lanes, and commits.
- Let the host trigger Stop hooks naturally at the end of a turn.
- Do not call the Stop hook manually except for explicit smoke tests or debugging.
- Do not assume DEVNS owns Claude, Codex, OpenAI Agents SDK, or any other provider runtime.
- Treat provider-specific review agents as adapters that must obey the same read-only lane-result contract.
