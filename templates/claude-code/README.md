# Claude Code Template

Copy `.claude/settings.json` into a project that has Never Stop installed.

Claude Code hook shape:

- Hooks live in `.claude/settings.json`.
- Most hook events use matcher groups.
- `Stop` does not use a matcher. It runs when Claude Code is about to stop.
- Claude Code sends hook input JSON on stdin.
- Returning `{"decision":"block","reason":"..."}` blocks stopping and feeds the reason back to Claude.
- To allow stop, exit successfully and print nothing.
- Stop hooks must handle `stop_hook_active` to avoid recursive blocking.

This template wires Claude Code's `Stop` event to the Never Stop stop-hook runner.
