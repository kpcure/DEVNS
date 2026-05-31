# Claude Code Template

Copy `.claude/settings.json` into a project that has DEVNS installed.

Claude Code hook shape:

- Hooks live in `.claude/settings.json`.
- Most hook events use matcher groups.
- `Stop` does not use a matcher. It runs when Claude Code is about to stop.
- Claude Code sends hook input JSON on stdin.
- `type: "agent"` Stop hooks spawn a Claude subagent from a prompt.
- Returning `{"ok":false,"reason":"..."}` blocks stopping and feeds the reason back to Claude.
- Returning `{"ok":true}` allows stop.
- Stop hooks must handle `stop_hook_active` to avoid recursive blocking.

This template wires Claude Code's `Stop` event to the DEVNS Stop Review Agent prompt. The hook agent reads DEVNS state, reviews/ingests missing `code-review` evidence for the active feature, then translates the final DEVNS stop decision to Claude Code's `ok` schema.
