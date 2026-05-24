# DEVNS Workspace

DEVNS stores project-local harness state in `.devns/`.

This directory is ignored by Git by default because it is runtime state for a target repository. Public templates and examples live elsewhere.

## Files

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

- `devns.config.json`: paths, hook policy, review lanes, and skill names.
- `project.md`: human-provided background, migration goals, and constraints.
- `index.md`: progressive-disclosure entrypoint for new agent sessions.
- `candidates.json`: discovered candidate features that are not executable yet.
- `features.json`: implementation queue. Items are claimable only after an approved RFC.
- `rfcs/`: RFC records for candidates and features.
- `history/`: execution summaries, changed-file evidence, verification results, and impact notes.
- `skills/`: project-local skill overrides or extra workflow notes.
- `policies/`: project-local harness rules.

## JSON Contracts

DEVNS workspace JSON files have fixed schemas:

```text
.devns/devns.config.json -> tools/schema/devns-config.schema.json
.devns/candidates.json   -> tools/schema/candidates.schema.json
.devns/features.json     -> tools/schema/features.schema.json
.devns/rfcs/*.json       -> tools/schema/rfc.schema.json
```

These contracts keep humans, agents, hooks, CLI commands, and the dashboard writing the same fields. v0.1 rejects arbitrary fields unless the schema declares an extension point.

## First Run

`devns-init` is the plugin skill that starts a project. It may call the command surface:

```sh
npm run devns:init -- --project-name "Example Project" --project-description "Migration background"
```

The command creates deterministic files. The skill then reads repository context and writes candidate features into `.devns/candidates.json`.

`init` is not a daemon or long-running server. It is a deterministic local command invoked by skills, hooks, or users when the workspace needs to be created.

## Candidate To Implementation

DEVNS keeps discovery separate from implementation:

```text
project background -> candidates.json -> devns-rfc -> approved RFC -> features.json -> devns-run
```

The run loop does not implement a one-line candidate directly. A feature must have a complete, approved RFC first.

`devns-rfc` can call:

```sh
npm run devns:rfc -- scaffold --id <candidate-or-feature-id>
npm run devns:rfc -- check --id <feature-id>
```

The skill performs requirement discovery and writes the actual RFC content. The CLI supplies the repeatable scaffold and readiness checks.
