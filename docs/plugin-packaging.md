# Plugin Packaging

DEVNS should be installable as a plugin for agent hosts, not only as loose templates.

## Claude Code

Claude Code plugins use:

```text
plugin-root/
  .claude-plugin/
    plugin.json
  hooks/
    hooks.json
  skills/
  agents/
  commands/
```

Important hook detail:

- `Stop` has no matcher.
- `hooks/hooks.json` defines the hook event.
- Hook input is delivered on stdin.
- `{"decision":"block","reason":"..."}` blocks stop.
- allow-stop behavior is successful exit with no block decision.
- Hooks are host lifecycle callbacks. The main agent should not call the Stop hook as its normal in-turn continuation mechanism.
- Multiple hooks for the same lifecycle event must not be treated as a portable serial pipeline. Persist review evidence before the stop attempt when possible; if hook-run review is configured, let one DEVNS stop command run the missing read-only agent lane and then aggregate state.

DEVNS plugin path:

```text
plugins/claude-code/devns/
```

DEVNS ships these Claude Code skill entrypoints:

- `skills/devns-init/SKILL.md`
- `skills/devns-rfc/SKILL.md`
- `skills/devns-run/SKILL.md`

The skill files are discovered from the plugin package. They do not need to be duplicated in the plugin manifest.

## Codex

Codex plugins use a manifest at:

```text
plugin-root/
  .codex-plugin/
    plugin.json
```

Companion folders can include:

```text
skills/
hooks/
scripts/
assets/
```

DEVNS plugin path:

```text
plugins/codex/devns/
```

DEVNS ships these Codex skill entrypoints:

- `skills/devns-init.md`
- `skills/devns-rfc.md`
- `skills/devns-run.md`

The Codex manifest advertises plugin capabilities. The loadable skill files live in `skills/`.

DEVNS keeps hook wiring out of `.codex-plugin/plugin.json`. The manifest points at skills and describes the plugin; `scripts/devns-stop-hook.sh` and `templates/codex/hooks.json` are optional host wiring assets.

`devns init --host codex` should prefer generating a project-local hook command with an absolute adapter path and `DEVNS_PROJECT_DIR`, so host cwd differences do not prevent the adapter from starting. DEVNS hook adapters and the shared stop core append diagnostics to `.devns/history/stop-hook.jsonl`; use `devns stop-log` to inspect recent invocations without polluting hook stdout.

## Packaging Rule

Plugins should be thin host adapters.

The harness logic lives in:

```text
packages/core/
```

Host plugins should only wire host-specific lifecycle events, skills, and agent surfaces into the same core runner.

DEVNS does not package an LLM provider. Provider-specific agents, subagents, CI jobs, and scripts are replaceable workers that produce or consume DEVNS JSON contracts.
