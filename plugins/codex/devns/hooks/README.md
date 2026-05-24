# DEVNS Hooks

Codex plugin hook support is represented here as an adapter target.

The Codex plugin does not put hook wiring in `.codex-plugin/plugin.json`. The manifest is for plugin identity and capabilities; this directory provides the host adapter assets.

The concrete local adapter is:

```sh
plugins/codex/devns/scripts/devns-stop-hook.sh
```

The adapter:

1. Resolves the project directory from `DEVNS_PROJECT_DIR`, `CODEX_PROJECT_DIR`, or `PWD`.
2. Forwards host stdin to the DEVNS stop-hook command.
3. Prefers `DEVNS_STOP_COMMAND` when set.
4. Otherwise calls `npm run devns:stop --silent` in the project.
5. Falls back to `npm run harness:stop --silent` for current development checkouts.

The stop command reads hook input JSON from stdin when the host provides it and evaluates the DEVNS feature inventory.

To wire it manually in a host that supports lifecycle hooks, point the host's stop event at:

```sh
bash plugins/codex/devns/scripts/devns-stop-hook.sh
```

Expected block output:

```json
{"decision":"block","reason":"Continue feature ..."}
```

Successful allow-stop behavior is exit code 0 with no required output.
