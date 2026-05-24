# Getting Started

DEVNS is a local-first harness for long-running agent work.

## Install

For local development from this repository:

```sh
npm install
npm run build
```

## Initialize A Project

In a target repository, create the DEVNS state directory:

```sh
npm run devns:init -- --project-name "Example Project" --project-description "Describe the migration or feature goal."
```

This creates:

```text
.devns/
  devns.config.json
  project.md
  index.md
  candidates.json
  features.json
  rfcs/
  history/
  skills/
  policies/
```

Then use the `devns-init` skill to scan repository context and fill `.devns/candidates.json`.

The first queue is intentionally candidates, not implementation-ready features. A candidate becomes executable only after `devns-rfc` turns it into an approved RFC and the item is promoted into `.devns/features.json`.

## Validate

```sh
npm run harness:validate
```

This is an early development command. DEVNS command-line entrypoints are intended as a local runtime surface for hooks, skills, plugins, dashboard actions, and automation. The primary human review experience is the dashboard and generated reports.

## Run The Dashboard

For this repository's local dashboard:

```sh
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Claude Code

Copy the Claude Code template:

```sh
cp -R templates/claude-code/.claude .claude
```

The Stop hook calls:

```sh
npm run harness:stop
```
