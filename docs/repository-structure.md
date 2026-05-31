# Repository Structure

DEVNS separates open-source product files from local intermediate work.

## Open-Source Surface

```text
packages/
  core/
    src/
      harness/
      cli/
apps/
  dashboard/
    src/
templates/
  devns/
  claude-code/
plugins/
  claude-code/
  codex/
examples/
  mission-migration-dashboard/
evals/
  cases/
  fixtures/
docs/
tools/
  schema/
```

## Ignored Workbench

```text
.workbench/
  local-project/
  notes/
  reports/
```

`.workbench/` is ignored by Git. It is where this repository can keep planning state, temporary reports, and intermediate feature inventories without mixing them into the open-source package.

## Directory Contracts

### `packages/core`

The reusable harness core.

Contains:

- feature inventory readers/writers
- hook evaluators
- local command entrypoints for hooks, skills, plugins, automation, and CI
- provider-neutral contracts

The command entrypoints are not meant to make DEVNS a CLI-first product. They are the stable local runtime surface shared by host-specific plugins, hooks, skills, the dashboard, and automation.

### `apps/dashboard`

The local HTML review plane.

Contains:

- React dashboard
- human-editable backlog UI
- review and extension views

### `templates`

Files users copy into their own projects.

Contains:

- `templates/devns`: starter `.devns` config and feature inventory
- `templates/claude-code`: Claude Code hook settings and setup notes

### `plugins`

Host-specific plugin packages.

Contains:

- `plugins/claude-code/devns`: Claude Code plugin package with `.claude-plugin/plugin.json`, `hooks/hooks.json`, skills, and agents
- `plugins/codex/devns`: Codex plugin package with `.codex-plugin/plugin.json`, skills, hooks, and scripts

Plugins should remain thin adapters. Shared harness behavior belongs in `packages/core`.

### `examples`

Stable public examples.

Contains:

- sample migration inventories
- small example projects later

Must not contain this repository's active local planning state.

### `evals`

The harness evaluation suite.

Contains:

- deterministic T1 gate fixtures
- frozen T2 review packets and gold findings later
- T3 seed repositories and hidden-oracle metadata later
- metrics and report helpers for precision, recall, F1, pass^k, and cost reporting

### `docs`

Public design and usage docs.

Only user-facing English docs belong here. Temporary notes, research, design debate, and planning drafts belong in `.workbench/`.

### `.workbench`

Ignored local development state.

Contains:

- the feature inventory used to build DEVNS itself
- scratch reports
- local experiment notes
- generated review output

Do not reference `.workbench` from public templates.

### `.devns`

Ignored runtime state created inside a repository that uses DEVNS.

Contains:

- `devns.config.json`
- `project.md`
- `index.md`
- `candidates.json`
- `features.json`
- `rfcs/`
- `history/`
- `skills/`
- `policies/`

This directory is the shared state surface for humans, agents, skills, hooks, and the dashboard.
