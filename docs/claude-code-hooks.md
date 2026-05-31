# Claude Code Hooks Integration

DEVNS's first concrete integration target is Claude Code's hook system.

## Claude Code Hook Model

Claude Code hooks are configured in `.claude/settings.json`.

This section is based on the Claude Code hooks and subagents documentation. The important product boundary for DEVNS is that hooks are host lifecycle callbacks, while subagents are provider-specific workers. DEVNS core should consume persisted JSON evidence from those workers rather than depending on a specific provider runtime.

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
- the hook can block stopping by printing JSON with `decision: "block"`
- the hook must handle `stop_hook_active` to avoid recursive blocking

Claude Code can match more than one hook for the same event, including `Stop`. Treat those hooks as independent checks, not as a same-event pipeline. A DEVNS design must not rely on one `Stop` hook producing a file or decision that a second `Stop` hook reads immediately in the same stop event.

DEVNS therefore models stop behavior as one deterministic command orchestrator with logical phases:

1. Inspect active feature completion gates and persisted lane/review evidence.
2. Block with a continuation reason when review, verification, commit, or evidence is missing.
3. Allow stop when the active feature satisfies completion policy.
4. When no feature is active and policy says `claim_next`, claim the next approved feature and block with the next implementation prompt.

Host-native agent hooks are optional adapters. For example, a Claude `type: "agent"` hook can act as a read-only reviewer, but DEVNS core still consumes provider-neutral lane result JSON rather than depending on Claude, Codex, or any LLM provider.

## Stop Hook Output

To allow stop, exit successfully and print nothing.

To block stop:

```json
{
  "decision": "block",
  "reason": "Continue feature NS-003. Verification evidence is missing."
}
```

The reason is shown back to Claude and becomes the continuation instruction.

## DEVNS Template

Use:

```text
templates/claude-code/.claude/settings.json
```

It wires Claude Code's `Stop` event to:

```sh
npm --prefix . run harness:stop
```

The actual runner is:

```text
packages/core/src/cli/claude-stop-hook.ts
```

The runner reads the active DEVNS feature inventory, applies the stop gate, and either blocks stopping with a continuation reason or allows Claude Code to stop.

The runner should stay fast. Long tests, browser automation, or LLM review should run before the final stop attempt and write evidence/history that the stop hook can inspect.

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
