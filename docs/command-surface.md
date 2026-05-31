# Command Surface

DEVNS includes command-line entrypoints, but it is not designed as a CLI-first product.

The command surface is the local runtime interface used by:

- Claude Code hooks
- Codex hooks or scripts
- project-local skills
- host-specific plugins
- the dashboard
- local automation
- CI or GitHub Actions

## Why A Command Surface Exists

Agent hosts expose different extension models. Claude Code has hooks and plugins. Codex has plugin packaging. Cursor may use rules, commands, scripts, or CI-style automation.

DEVNS needs one portable substrate underneath those host-specific adapters.

The command surface provides that substrate. It lets integrations call stable commands while the shared implementation remains in `packages/core`.

## What DEVNS Controls

The command surface is where DEVNS can provide and version the default harness behavior:

- initialization behavior
- prompt and skill defaults
- hook behavior
- lane execution
- task state transitions
- validation and evidence writing
- report generation
- resolved configuration inspection

Projects can still override these pieces through config, local skills, local agents, policies, lanes, and UI panels.

## Intended Boundary

Humans should usually work through the dashboard and reports.

Agents should usually work through `AGENTS.md`, skills, hooks, and structured JSON.

Hooks, skills, plugins, dashboard actions, and automation should call the command surface.

This keeps host adapters thin and avoids duplicating harness behavior in each plugin.

## Available Development Commands

The user-facing entrypoint is:

```sh
npx @kpcure/devns <command>
```

Use the scoped npm package `@kpcure/devns`. The unscoped `devns` package name on npm belongs to another project.

The command argument is intentionally small and prompt-friendly: `doctor`, `init`, `run`, `dashboard`, `validate`, `discover`, `rfc`, `queue`, `lanes`, `review`, `complete`, or `stop`. Skills and hooks may call more specific internal scripts, but humans and general agents should start with this single entrypoint. In this source checkout, `npm run devns -- <command>` is the local development equivalent.

The current repository also exposes thin npm-backed internal development commands:

```sh
npx @kpcure/devns doctor [--json]
npx @kpcure/devns init --project-name "Project" --project-description "Goal"
npx @kpcure/devns run [--json] [--no-claim]
npx @kpcure/devns dashboard
npx @kpcure/devns validate [--json] [--strict] [--fix]

npm run devns:init
npm run devns:doctor [-- --json]
npm run devns:status [-- --json]
npm run devns:dashboard
npm run devns:run [-- --json] [-- --no-claim]
npm run devns:discover [-- --json] [-- --force]
npm run devns:lanes -- run [--feature <feature-id>] [--write] [--json]
npm run devns:lanes -- ingest --feature <feature-id> --result <lane-result.json> [--actor review-agent:<name>] [--json]
npm run devns:evidence -- add --feature <feature-id> --type <type> --summary <text> [--verification <kind>] [--covers-ac AC-001]
npm run devns:review -- generate [--date YYYY-MM-DD] [--json]
npm run devns:review -- packet [--feature <feature-id>] [--commit <sha>] [--base <sha>] [--format json|prompt] [--write] [--json]
npm run devns:complete -- [--id <feature-id>] [--commit <sha>] [--review approved|needs_changes|follow_up] [--force --reason <text>] [--json]
npm run devns:queue -- status [--json]
npm run devns:queue -- next [--json]
npm run devns:queue -- claim [--id <feature-id>] [--json]
npm run devns:rfc -- scaffold --id <candidate-or-feature-id>
npm run devns:rfc -- clarify --id <candidate-or-feature-id>
npm run devns:rfc -- check --id <feature-id>
npm run devns:stop
npm run harness:validate [-- --json] [-- --strict] [-- --fix]
npm run harness:stop
```

`npm run devns:init` creates `.devns/` with the files that skills, hooks, the dashboard, and agents share. It is the deterministic substrate under the `devns-init` skill.

`npm run devns:doctor` is the first command to run after install. It checks whether the workspace exists, validates that the feature inventory can load, reports the current mode, and prints the next action.

In a target repository, this alias may not exist yet. Agents should inspect `package.json` and fall back to the available DEVNS status surface, usually `npm run devns:status -- --json` or `npm run devns:queue -- status --json`, before declaring the workflow blocked.

`npm run devns:status` is a short alias for queue status. It is useful for dashboard debugging and human inspection.

`npm run devns:dashboard` starts the local human control plane at `http://127.0.0.1:5173/`.

`npm run devns:run` is the agent-facing loop entry. It detects bootstrap, active, claimable, blocked, and empty-queue modes. By default it claims the next approved feature when no feature is active; pass `--no-claim` to inspect without mutating state. When a feature is active or claimed, JSON output includes `workerHandoff`, a compact contract for running that one feature in an isolated worker/subagent or fresh implementation context when the host supports it.

`npm run devns:discover` is the deterministic substrate under the `devns-init` skill. It reads a conservative set of project signals and writes candidate features to `.devns/candidates.json`. It never creates claimable features.

`npm run devns:lanes -- run` executes configured review lanes. Command lanes capture exit code, duration, stdout/stderr digests, evidence, and a decision of `allow`, `warn`, `needs_human_review`, or `block`. Pass `--write` to append the full lane result envelope to feature history and store concise lane evidence on the active feature.

A browser smoke check can be wired as a command lane, for example by copying `templates/devns/lanes/browser-smoke.json` into `.devns/lanes/browser-smoke.json` and changing the command to the project's Playwright/Cypress/browser script. Browser evidence should be recorded with `verificationType: "browser_smoke"`.

`npm run devns:lanes -- ingest` records a lane-result JSON envelope produced by a read-only review agent or external verifier. DEVNS validates the lane-result schema before writing history and compact evidence.

`npm run devns:evidence -- add` records human, browser, review-agent, command, or static-review evidence without hand-editing `.devns/features.json`. Use `--covers-ac` and `--covers-req` to explicitly link the evidence to acceptance criteria or requirements.

For robust review automation, run deterministic static and dynamic lanes first, then run any read-only review-agent lane against the Git diff, RFC, lane output, and relevant history. The Stop hook should only aggregate those persisted results.

`evidence-quality-gate` is a built-in review lane that checks acceptance criteria and deterministic evidence coverage. It is also used by validation and completion so a feature cannot be marked done from a title plus prose-only notes.

`npm run devns:review -- generate` creates `.devns/reviews/<date>.json` and `.md`. The report groups completed work by feature, includes RFC intent, commits, changed files, lane evidence, history decisions/pitfalls/lessons, cross-feature risks, and suggested human actions.

`npm run devns:review -- packet` creates a bounded review-agent packet for one feature. Use `--format prompt --write` when handing the packet to a read-only review agent. The packet includes RFC context, Git status and diff, evidence quality, feature evidence, durable history, and project rules. Use `--commit HEAD` or `--base <sha> --commit <sha>` when reviewing a clean worktree after the implementation commit but before `devns complete`.

`npm run devns:complete` marks one feature done after verification evidence exists. It records the implementation commit in `implementationCommit` and preserves `commit` as a compatibility alias. If the DEVNS metadata update is committed separately, pass its hash later as `metadataCommit`; the implementation commit does not need to contain the hash of the metadata commit that follows it. Approved completion requires human, browser, or read-only review evidence when evidence quality says the feature still needs review; `--force` is reserved for explicit human override and must include `--reason`.

Completion should normally follow this order:

1. Implement and commit the feature code.
2. Run static, dynamic, and optional read-only review-agent lanes with `--write`.
3. Run `devns complete` to record completion metadata and history.
4. Commit the DEVNS metadata update separately when the project wants exact state provenance.

This two-commit model avoids the hash paradox where a feature commit would need to know the hash of a later metadata-only commit.

`npm run devns:queue` wraps Task Queue core behavior:

- `status` reports inventory totals, active feature, next claimable feature, and RFC-blocked ready work.
- `next` returns the next claimable feature without mutating state.
- `claim` claims the next feature, or a specific `--id`, through the Task Queue and Feature Store.

`npm run devns:rfc` provides deterministic RFC helpers for skills:

- `scaffold` creates a structured RFC draft under the configured RFC directory.
- `clarify` emits bounded recommendation-first questions for missing intent, scope, outcome, or verification detail.
- `check` evaluates whether a feature's attached RFC satisfies the claim gate.

`npm run devns:stop` is the host-neutral stop-hook command. Host adapters such as Claude Code or Codex should call this command instead of reimplementing stop behavior.

`npm run harness:validate` validates the local harness workspace, feature state, RFC/candidate schemas, lane configuration and evidence, Stop hook adapter boundaries, prompt-contract files, and durable history quality. By default, legacy migration gaps are warnings so the project can continue running. Pass `--strict` for a hard audit where warnings fail, `--json` for hook/CI consumption, and `--fix` to create missing DEVNS directories.

## Planned Stable Commands

The intended package-level commands are:

```sh
devns init
devns validate
devns status
devns next
devns claim
devns run-lanes
devns hook claude-stop
devns hook user-prompt-submit
devns report
devns inspect
```

These commands should produce structured output where hooks, plugins, or agents need to consume the result.
