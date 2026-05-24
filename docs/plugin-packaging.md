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

## Packaging Rule

Plugins should be thin host adapters.

The harness logic lives in:

```text
packages/core/
```

Host plugins should only wire host-specific lifecycle events, skills, and agent surfaces into the same core runner.
