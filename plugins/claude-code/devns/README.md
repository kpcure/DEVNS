# DEVNS Claude Code Plugin

This plugin installs:

- a `Stop` hook using Claude Code's `type: "agent"` mode
- `devns-init` skill for initial feature discovery
- `devns-rfc` skill for requirement clarification before implementation
- `devns-run` skill for the feature implementation loop
- a code-review subagent template
- prompt contracts under `prompts/`

Recommended first check after installation, when the target project exposes it:

```sh
npm run devns:doctor
```

The doctor reports whether the repository needs init, RFC clarification, feature implementation, or no further work. If that alias is missing, inspect `package.json` and use the available DEVNS status command, usually `npm run devns:status -- --json` or `npm run devns:queue -- status --json`.

The project must provide:

- `.devns/devns.config.json`
- a feature inventory referenced by that config
- the DEVNS package scripts from this repository

Claude Code details:

- `Stop` hooks do not use a matcher.
- Hook input is provided on stdin.
- Command hooks block by printing `{"decision":"block","reason":"..."}`.
- Agent hooks block by returning `{"ok":false,"reason":"..."}` and allow stop with `{"ok":true}`.
- A Stop hook must handle `stop_hook_active` to avoid recursion.
- Stop hooks are lifecycle callbacks triggered by Claude Code, not normal commands the main agent should call mid-turn.
- Do not depend on two same-event Stop hooks as a serial pipeline.
- The DEVNS Claude hook is one agent prompt: it reads active feature state, generates/reads a review packet, performs code review, ingests one lane-result JSON object, then translates the final DEVNS stop decision to Claude's `ok` schema.
- DEVNS does not provide an LLM provider. Claude subagents are optional read-only workers behind the provider-neutral DEVNS lane-result contract.
