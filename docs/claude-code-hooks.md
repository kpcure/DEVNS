# Claude Code Hooks Integration

DEVNS's first concrete integration target is Claude Code's hook system.

## Claude Code Hook Model

Claude Code hooks are configured in `.claude/settings.json`.

This section is based on the Claude Code hooks and subagents documentation at `https://code.claude.com/docs/en/hooks`. The important product boundary for DEVNS is that hooks are host lifecycle callbacks, while subagents are provider-specific workers. DEVNS core should consume persisted JSON evidence from those workers rather than depending on a specific provider runtime.

Most hook events are configured as matcher groups:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node ./scripts/check-edit.js"
          }
        ]
      }
    ]
  }
}
```

Events such as `UserPromptSubmit` and `Stop` do not need matchers. `Stop` is the first hook DEVNS uses for the control loop:

- it does not use a matcher
- it runs when Claude Code is about to stop
- Claude Code passes input JSON on stdin
- the hook must handle `stop_hook_active` to avoid recursive blocking

Claude Code supports command hooks and experimental agent hooks:

- `type: "command"` runs a shell command; it can block by printing JSON with `decision: "block"`.
- `type: "agent"` spawns a Claude subagent from a `prompt`; it can block by returning JSON with `ok: false` and `reason`.

Claude Code can match more than one hook for the same event, including `Stop`. Treat those hooks as independent checks, not as a same-event pipeline. A DEVNS design must not rely on one `Stop` hook producing a file or decision that a second `Stop` hook reads immediately in the same stop event.

DEVNS therefore models stop behavior as one logical orchestrator with host-specific implementations:

- Claude Code uses a `type: "agent"` Stop hook whose prompt inspects DEVNS state, runs/ingests missing code review evidence, and then returns Claude's `ok` schema.
- Codex uses a command adapter because Codex hook wiring is script-based in DEVNS today.

The logical phases are:

1. Inspect active feature completion gates and persisted lane/review evidence.
2. Optionally run configured missing read-only Review Agent lanes and persist provider-neutral lane-result evidence.
3. Block with a continuation reason when review, verification, commit, or evidence is missing.
4. Allow stop when the active feature satisfies completion policy.
5. When no feature is active and policy says `claim_next`, claim the next approved feature and block with the next implementation prompt.

The Claude agent hook should not call another LLM reviewer when it is already acting as the reviewer. It should generate a review packet, perform the review in that hook agent, ingest one `lane:code-review` result, and then run the deterministic final DEVNS stop decision with `DEVNS_STOP_AGENT_HOOK=claude`.

## Stop Hook Output

For a command hook, allow stop by exiting successfully and printing nothing.

For a command hook, block stop with:

```json
{
  "decision": "block",
  "reason": "Continue feature CAND-003. Verification evidence is missing."
}
```

The reason is shown back to Claude and becomes the continuation instruction.

For an agent hook, allow stop with:

```json
{ "ok": true }
```

For an agent hook, block stop with:

```json
{ "ok": false, "reason": "Continue feature CAND-003. Verification evidence is missing." }
```

## DEVNS Template

Use:

```text
templates/claude-code/.claude/settings.json
```

It wires Claude Code's `Stop` event to a `type: "agent"` hook with this shape:

```json
{
  "type": "agent",
  "prompt": "You are the single DEVNS Stop Review Agent hook..."
}
```

The prompt tells the hook agent to read:

```text
plugins/claude-code/devns/prompts/stop-review-agent-hook.md
```

That prompt is the Claude-native orchestration contract: inspect active feature state, review/ingest missing `code-review` evidence, run the final DEVNS stop decision, and translate it to the agent hook `ok` schema.

The hook should stay bounded. Long tests, browser automation, and arbitrary project commands should run before the final stop attempt and write evidence/history that the hook can inspect. The hook agent may perform read-only review from a bounded packet and write only DEVNS lane evidence/history.

## Optional UserPromptSubmit Hook

DEVNS can also use Claude Code's `UserPromptSubmit` hook as a bootstrap helper.

`UserPromptSubmit` runs after the user submits a prompt and before Claude processes it. For DEVNS, this hook should only inject short context:

- whether the project has a DEVNS inventory
- whether the feature list is empty
- whether an active feature is already claimed
- where Claude should read the operating protocol, such as `AGENTS.md`
- whether the next step should be bootstrap discovery instead of coding

This hook is Claude Code-specific. The portable startup path remains `devns-init`, `npm run devns:init`, `AGENTS.md`, and the dashboard.

For context injection, the hook can return JSON with `hookSpecificOutput.additionalContext`. It should not run expensive repository discovery on every user prompt.
