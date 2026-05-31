# Getting Started

DEVNS is a local-first harness for long-running agent work. JSON is the shared state for agents, hooks, skills, and the dashboard. Markdown holds durable project knowledge. The dashboard is the human control plane.

## Install

For local development from this repository:

```sh
npm install
npm run build
```

Use the scoped npm package. The unscoped `devns` name on npm belongs to another package.

```sh
npx @kpcure/devns doctor
```

## Initialize A Project

Start with the doctor. It reports the current mode and the next action:

```sh
npx @kpcure/devns doctor
```

In a target repository, create the DEVNS state directory:

```sh
npx @kpcure/devns init --project-name "Example Project" --project-description "Describe the migration or feature goal."
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

By default `init` uses `--host auto`: when it is run inside Codex or Claude Code it also writes the matching local host adapter. Use `--host codex`, `--host claude`, `--host both`, or `--host none` to be explicit. The Codex adapter writes `.codex/hooks.json` with an absolute hook command, installs `plugins/codex/devns/`, marks `plugins/codex/devns/scripts/devns-stop-hook.sh` executable, and prepares `.devns/adapters/code-review.codex.sh` plus `.devns/lanes/code-review.json` for read-only review-agent lanes. The Claude adapter writes `.claude/settings.json` as a `type: "agent"` Stop hook; its prompt reads active DEVNS state, performs/ingests missing `code-review` evidence, and returns Claude's `ok` hook schema.

Then use the `devns-init` skill to scan repository context and fill `.devns/candidates.json`.

The first queue is intentionally candidates, not implementation-ready features. A candidate becomes executable only after `devns-rfc` turns it into an approved RFC and the item is promoted into `.devns/features.json`.

## Ten-Minute First Run

1. Install dependencies:

```sh
npm install
```

1. Ask DEVNS what state the repository is in:

```sh
npx @kpcure/devns doctor
```

1. If the workspace is missing, initialize it:

```sh
npx @kpcure/devns init --project-name "Example Project" --project-description "Describe the migration or feature goal."
```

1. Ask an agent to use the `devns-init` skill to discover candidate features. Do not implement from discovery output.
   The deterministic discovery command is:

```sh
npx @kpcure/devns discover --json
```

2. Ask an agent to use the `devns-rfc` skill for selected candidates. Only approved RFCs can become ready features.
3. Start or inspect the implementation loop:

```sh
npx @kpcure/devns run --json
```

1. Open the dashboard when you want the human view:

```sh
npx @kpcure/devns dashboard
```

If Stop hook behavior is unclear, inspect the local hook trace:

```sh
npx @kpcure/devns stop-log --tail 20
```

The trace lives at `.devns/history/stop-hook.jsonl` and records adapter invocation, command selection, core decision mode, selected feature, and block reasons without writing diagnostics to hook stdout.

## Validate

```sh
npx @kpcure/devns validate
```

This is a deterministic health check, not an LLM reviewer. It checks workspace shape, schemas, RFC readiness, evidence quality, lane records, hook wiring, and history/report artifacts. For semantic validation, configure a `type: "agent"` review lane or record browser/human/review-agent evidence before completion.

DEVNS command-line entrypoints are intended as a local runtime surface for hooks, skills, plugins, dashboard actions, and automation. The primary human review experience is the dashboard and generated reports.

## Run The Dashboard

For this repository's local dashboard:

```sh
npx @kpcure/devns dashboard
```

Open `http://127.0.0.1:5173/`.

## Agent Skill Path

Use these skills when the host supports them:

- `devns-init`: create or refresh candidates from project context. It must not implement code.
- `devns-rfc`: clarify a candidate or feature into an approved RFC. It owns requirement discovery and readiness judgment.
- `devns-run`: continue the active feature or claim one approved feature. It must update evidence/history and commit exactly one feature before completion.

The skills and CLI are two doors into the same state workflow. They both operate on `.devns` JSON and linked Markdown context.

## Claude Code

Copy the Claude Code template:

```sh
cp -R templates/claude-code/.claude .claude
```

The Claude Code Stop hook uses:

```json
{ "type": "agent", "prompt": "You are the single DEVNS Stop Review Agent hook..." }
```

The Stop hook is triggered by the host when the client is about to stop. Do not use it as the normal command an agent calls to keep working.

Run review/test lanes before the final stop attempt and persist evidence in `.devns/history/` and `.devns/features.json` when possible. In Claude Code, the Stop hook agent may perform the missing read-only code review itself and ingest one lane result before translating the final DEVNS stop decision to `{"ok":true}` or `{"ok":false,"reason":"..."}`.

DEVNS does not provide an LLM provider. Claude subagents, Codex tasks, CI jobs, local scripts, or humans can act as review workers if they produce the DEVNS lane-result contract.
