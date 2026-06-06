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

`devns init --host codex` writes a project-local `.codex/hooks.json` with `DEVNS_PROJECT_DIR` and an absolute path to the adapter script. That is more reliable than a relative hook command when the host does not run hooks from the repository root.

In this repository, `.codex/hooks.json` is intentionally ignored as a local host configuration file. The tracked template is the reusable version; the local file points the current Codex client at the same adapter.

Hook diagnostics are written to:

```text
.devns/history/stop-hook.jsonl
```

Use:

```sh
npm run devns -- stop-log --tail 20
```

The adapter records whether it was invoked and which stop command it selected. The core records the decision mode, selected feature, and blocker reasons. Hook stdout remains reserved for the host protocol: empty output allows stop, and `{"decision":"block","reason":"..."}` blocks stop with the continuation reason.

`devns orchestrate --host codex --json` is the preferred long-run path. It returns explicit launch instructions for Codex custom agents. Stop-hook claim-next remains a safety-net fallback, not the primary loop.

When the core claims the next feature, the block reason includes a compact worker handoff: feature context, requirements, acceptance criteria, RFC validation plan, configured lanes, and whether a semantic agent lane is available. This is intentionally richer than a one-line prompt so hosts that continue from the block reason have enough context to recover.

## Codex Custom Agents

`devns init --host codex` installs:

```text
.codex/agents/devns_feature_worker.toml
.codex/agents/devns_code_reviewer.toml
```

Codex custom agents must be explicitly requested by the parent prompt. DEVNS orchestrator packets therefore include launch instructions that say to spawn `devns_feature_worker` for implementation and `devns_code_reviewer` for read-only review.

## Code Review Agent Lane

`devns init --host codex` also prepares a read-only review worker:

```text
.devns/adapters/code-review.codex.sh
.devns/lanes/code-review.json
.codex/agents/devns_code_reviewer.toml
```

The lane command is:

```sh
bash .devns/adapters/code-review.codex.sh
```

When `devns lanes run --feature <id> --write --json` runs this lane, DEVNS first writes a review packet and prompt containing the feature RFC, acceptance criteria, Git status/diff, evidence quality, existing evidence, history, and project rules. The adapter runs `codex exec` in read-only mode and returns one lane-result JSON object.

The Stop hook can also run this missing lane itself when `hooks.stop.reviewAgent.mode` is `run_missing`. That still uses one Stop Hook, not two parallel hooks: the orchestrator runs the read-only review lane, persists evidence/history, updates the feature review decision, and then returns one unified allow/block decision.

## Validation

From this repository:

```sh
python3 /Users/wumeng/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex/devns
```
