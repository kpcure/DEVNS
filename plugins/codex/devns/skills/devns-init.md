# DEVNS Init

Use this skill when a repository is being prepared for DEVNS and the feature inventory is empty, incomplete, or needs to be rebuilt from project context.

## Goal

Create the `.devns/` workspace if needed, collect project background, and discover candidate features. Do not implement code.

## Bootstrap

1. If `.devns/devns.config.json` is missing, run:

```sh
npm run devns:init -- --project-name "<project name>" --project-description "<project background>"
```

1. If the user has not provided enough background, update `.devns/project.md` with known context and ask for the smallest missing input needed to continue.
2. Read `AGENTS.md`, `.devns/index.md`, `.devns/project.md`, and `.devns/devns.config.json`.

## Workflow

1. Read `AGENTS.md` and project rules if present. Treat the DEVNS Context Index section as the entrypoint and follow links progressively.
2. Inspect repository structure, README, docs, routes, API/schema files, tests, and known legacy/new paths.
3. Look for both visible product features and implicit harness requirements.
4. Produce candidate features with source references, confidence, suggested priority, suggested milestone, and known unknowns.
5. Write or propose updates to `.devns/candidates.json`.
6. Do not mark candidates as `ready`.
7. Ask the human to confirm which candidates should be clarified into RFCs.

## Implicit Requirements To Look For

- State files and JSON field contracts
- Schema, validation, migration, and versioning needs
- Human and agent write-back paths
- Reviewability, evidence, and audit trail needs
- Concurrency or overwrite risks between humans, agents, hooks, and dashboards
- Host integration assumptions such as hooks, skills, commands, rules, or CI
- Extension points that a project may need to override

## Rules

- Do not edit implementation files.
- Do not create `ready` work from a one-line feature description.
- Each candidate must later pass the `devns-rfc` clarification skill before implementation.
- `features.json` is the implementation queue; `candidates.json` is the discovery queue.
