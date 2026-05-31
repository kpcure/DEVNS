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

The adapter is a lifecycle target, not the primary way an agent should continue work during a normal turn. The host calls it when the client is about to stop.

Do not wire DEVNS as two same-event Stop hooks where the first hook runs review and the second hook immediately reads that result. Hosts may execute matching hooks independently or in parallel. Run review lanes before the final stop attempt, persist their JSON evidence/history, then let the DEVNS stop command aggregate that state.

To wire it manually in a host that supports lifecycle hooks, point the host's stop event at:

```sh
bash plugins/codex/devns/scripts/devns-stop-hook.sh
```

Expected block output:

```json
{"decision":"block","reason":"Continue feature ..."}
```

Successful allow-stop behavior is exit code 0 with no required output.
