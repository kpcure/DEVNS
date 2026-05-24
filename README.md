# DEVNS

DEVNS is an extension-first harness for long-running agent work where agents keep shipping small, verified units of work while humans review the outcome through an HTML control plane.

The core idea is simple:

- Markdown and JSON remain the agent-readable source of truth.
- HTML becomes the human review surface.
- Every agent run claims one feature, implements it, verifies it, commits it, records evidence, and loops.
- The next morning review is not a raw commit list. It is a structured mission report grouped by milestone, risk, behavior, evidence, and diff.
- The core is generic, but the edges are designed for second development: skills, hooks, review agents, test agents, sensors, and UI panels can be replaced by each project.

This project is inspired by the May 20, 2026 Claude blog article, [Using Claude Code: The unreasonable effectiveness of HTML](https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html), which argues that HTML is unusually effective as a human-in-the-loop interface for agent work because it is easier to inspect, navigate, and interact with than plain Markdown for many review tasks.

## Problem

Modern coding agents are fast enough that the bottleneck is no longer only implementation speed. With multiple agents, sessions, or overnight loops, the human reviewer can quickly become the constraint.

Reviewing ten independent feature commits in the morning is workable, but inefficient:

- The reviewer must reconstruct intent from commit messages and diffs.
- Feature behavior, tests, risks, and acceptance criteria are scattered.
- Milestone progress is hard to scan.
- Regressions are easier to miss because commits are reviewed as isolated Git artifacts rather than as a product migration story.

DEVNS treats review as a first-class product surface.

## Philosophy

Generic workflows are rarely adopted unchanged by serious engineering teams. Each repository already has its own tests, risk model, release rules, domain language, and review habits.

DEVNS therefore provides a stable harness core with editable edges. Use the defaults to start, then replace the parts that do not fit your project.

## Local Runtime, Not A CLI-First Product

DEVNS includes command-line entrypoints, but the CLI is not the primary product experience.

The CLI is the local runtime surface used by hooks, skills, plugins, the dashboard, local automation, and CI. It gives those integrations one stable way to call the harness core instead of depending on internal TypeScript files or reimplementing behavior per host.

This matters because Claude Code, Codex, Cursor, and future hosts expose different plugin and hook models. The command surface is the shared base where DEVNS can control default prompts, skills, hooks, lanes, policies, state transitions, and evidence writing while still letting projects override those pieces through configuration.

Humans should usually interact with the HTML dashboard and reports. Agents should usually interact through `AGENTS.md`, skills, hooks, and structured JSON. The command surface is the portable substrate underneath those interfaces.

## Workflow

1. A human or discovery agent writes feature inventory into JSON.
2. Background Markdown files capture context, constraints, implementation notes, and tests.
3. An agent reads `AGENTS.md`, claims the next task, implements it, verifies it, and commits exactly one feature.
4. A stop hook triggers review and validation agents.
5. If verification passes, the hook updates task state and asks the agent to claim the next task.
6. A static HTML dashboard renders both agent-facing task state and human-facing milestone review.

## Repository Shape

- `AGENTS.md`: operating protocol for coding agents.
- `docs/repository-structure.md`: open-source file layout and ignored local workbench policy.
- `docs/getting-started.md`: first-run setup.
- `docs/command-surface.md`: local runtime command surface rationale.
- `docs/configuration.md`: DEVNS config reference.
- `docs/devns-workspace.md`: `.devns/` workspace contract.
- `docs/feature-schema.md`: feature inventory format.
- `docs/claude-code-hooks.md`: actual Claude Code hook model and Stop hook integration.
- `docs/codex-plugin.md`: Codex plugin package notes.
- `docs/plugin-packaging.md`: plugin package layout.
- `examples/mission-migration-dashboard/features.json`: sample task inventory.
- `templates/devns/devns.config.json`: starter harness configuration.
- `templates/claude-code/.claude/settings.json`: Claude Code hook configuration template.
- `plugins/claude-code/devns/`: Claude Code plugin package.
- `plugins/codex/devns/`: Codex plugin package.
- `tools/schema/features.schema.json`: JSON schema for feature inventory.
- `hooks/stop-hook.md`: Stop hook design reference.
- `packages/core/src/harness/`: actual harness core code.
- `packages/core/src/cli/claude-stop-hook.ts`: Claude Code Stop hook runner.
- `apps/dashboard/`: local HTML review plane.
- `.workbench/`: ignored local state and intermediate artifacts for developing this repository.

## Current Status

This is the first public skeleton: documentation, schema, example data, a static dashboard prototype, plugin packages, and a thin local command surface for initialization, validation, and hook execution. The next milestone is to harden that command surface so plugins, skills, hooks, and reports can call the same core behavior.

## Local Development

Initialize a local DEVNS workspace:

```sh
npm install
npm run devns:init -- --project-name "Example Project" --project-description "Describe the migration or feature goal."
open .devns/workbench/index.html
```

Run the development dashboard:

```sh
npm run dev
```

Then open `http://127.0.0.1:5173/`.

Build verification:

```sh
npm run build
```

Claude Code Stop hook setup:

```sh
cp -R templates/claude-code/.claude .claude
npm run harness:validate
```
