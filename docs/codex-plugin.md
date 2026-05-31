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

- `.codex-plugin/plugin.json`
- `skills/devns-init.md`
- `skills/devns-rfc.md`
- `skills/devns-run.md`
- `hooks/README.md`
- `scripts/devns-stop-hook.sh`

The RFC skill exists because the core RFC gate will not claim a `ready` feature unless its RFC is approved.

The `devns-init` skill is the intended first user-facing entrypoint. It can call `npm run devns:init` to create `.devns/`, then scan repository context and fill `.devns/candidates.json`.

Skill files are loaded from the plugin package's `skills/` directory. They are not listed one by one inside `.codex-plugin/plugin.json`; the manifest declares `"skills": "./skills/"`, plugin identity, and presentation metadata.

The Codex plugin is a thin adapter. Shared harness logic lives in:

```text
packages/core/
```

## Stop Hook Adapter

Codex plugin validation does not support hook wiring in `.codex-plugin/plugin.json`. DEVNS therefore ships a stop-hook adapter script instead of embedding host-specific behavior in the manifest:

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

For dogfood or manual local wiring, copy or adapt:

```text
templates/codex/hooks.json
```

In this repository, `.codex/hooks.json` is intentionally ignored as a local host configuration file. The tracked template is the reusable version; the local file points the current Codex client at the same adapter.

## Validation

From this repository:

```sh
python3 /Users/wumeng/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex/devns
```
