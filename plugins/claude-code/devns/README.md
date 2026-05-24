# DEVNS Claude Code Plugin

This plugin installs:

- a `Stop` hook that calls `npm --prefix "$CLAUDE_PROJECT_DIR" run harness:stop`
- `devns-init` skill for initial feature discovery
- `devns-rfc` skill for requirement clarification before implementation
- `devns-run` skill for the feature implementation loop
- a code-review subagent template

The project must provide:

- `.devns/devns.config.json`
- a feature inventory referenced by that config
- the DEVNS package scripts from this repository

Claude Code details:

- `Stop` hooks do not use a matcher.
- Hook input is provided on stdin.
- Printing `{"decision":"block","reason":"..."}` blocks Claude Code from stopping.
- A Stop hook must handle `stop_hook_active` to avoid recursion.
