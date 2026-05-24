# Command Surface

DevNS includes command-line entrypoints, but it is not designed as a CLI-first product.

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

DevNS needs one portable substrate underneath those host-specific adapters.

The command surface provides that substrate. It lets integrations call stable commands while the shared implementation remains in `packages/core`.

## What DevNS Controls

The command surface is where Never Stop can provide and version the default harness behavior:

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

The current repository currently exposes thin npm-backed development commands:

```sh
npm run devns:init
npm run devns:queue -- status [--json]
npm run devns:queue -- next [--json]
npm run devns:queue -- claim [--id <feature-id>] [--json]
npm run devns:rfc -- scaffold --id <candidate-or-feature-id>
npm run devns:rfc -- check --id <feature-id>
npm run devns:stop
npm run harness:validate
npm run harness:stop
```

`npm run devns:init` creates `.devns/` with the files that skills, hooks, the dashboard, and agents share. It is the deterministic substrate under the `devns-init` skill.

`npm run devns:queue` wraps Task Queue core behavior:

- `status` reports inventory totals, active feature, next claimable feature, and RFC-blocked ready work.
- `next` returns the next claimable feature without mutating state.
- `claim` claims the next feature, or a specific `--id`, through the Task Queue and Feature Store.

`npm run devns:rfc` provides deterministic RFC helpers for skills:

- `scaffold` creates a structured RFC draft under the configured RFC directory.
- `check` evaluates whether a feature's attached RFC satisfies the claim gate.

`npm run devns:stop` is the host-neutral stop-hook command. Host adapters such as Claude Code or Codex should call this command instead of reimplementing stop behavior.

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
