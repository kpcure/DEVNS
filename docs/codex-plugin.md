# Codex Plugin

DEVNS includes a Codex plugin package at:

```text
plugins/codex/devns/
```

The plugin manifest is:

```text
plugins/codex/devns/.codex-plugin/plugin.json
```

The package includes:

- `skills/devns-init.md`
- `skills/devns-rfc.md`
- `skills/devns-run.md`
- `hooks/README.md`
- `scripts/devns-stop-hook.sh`

The RFC skill exists because the core RFC gate will not claim a `ready` feature unless its RFC is approved.

The `devns-init` skill is the intended first user-facing entrypoint. It can call `npm run devns:init` to create `.devns/`, then scan repository context and fill `.devns/candidates.json`.

Skill files are loaded from the plugin package's `skills/` directory. They are not listed one by one inside `.codex-plugin/plugin.json`; the manifest declares the plugin identity and capabilities, while the directory structure provides the skills.

The Codex plugin is a thin adapter. Shared harness logic lives in:

```text
packages/core/
```

## Stop Hook Adapter

Codex plugin validation does not require hook wiring in `.codex-plugin/plugin.json`. DEVNS therefore ships a stop-hook adapter script instead of embedding host-specific behavior in the manifest:

```sh
bash plugins/codex/devns/scripts/devns-stop-hook.sh
```

The script resolves the target project, forwards stdin to the DEVNS stop command, and calls:

```sh
npm run devns:stop --silent
```

It falls back to `npm run harness:stop --silent` for current development checkouts. Hosts or users can override the command with:

```sh
DEVNS_STOP_COMMAND="npm run devns:stop --silent"
```

## Validation

From this repository:

```sh
python3 /Users/wumeng/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex/devns
```
