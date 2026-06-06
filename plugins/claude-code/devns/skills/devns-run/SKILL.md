---
name: devns-run
description: Use the DEVNS orchestrator to claim or continue one feature, delegate implementation/review to subagents, verify, record evidence, and commit one feature.
---

# DEVNS Run

Use this skill when working in a repository with DEVNS configured.

If you are unsure what to do, check the workspace first:

```sh
npx @kpcure/devns doctor --json
```

## Workflow

Start by running the orchestrator command surface:

```sh
npx @kpcure/devns orchestrate --host claude --json
```

Then follow the returned mode:

1. `bootstrap_required`: run `devns-init` first.
2. `continue_active`: keep the main agent as orchestrator and launch the implementation/review subagents from the packet.
3. `claim_next`: use the returned implementation subagent prompt for exactly one approved feature.
4. `blocked_ready`: run `devns-rfc` or ask for human RFC approval.
5. `empty_queue`: stop unless the human adds new candidates or features.

Inside one feature loop:

1. Read the approved RFC and linked context.
2. Main agent does not implement product code by default.
3. Use the `devns-feature-worker` subagent with `implementationSubagent.prompt`.
4. When the worker returns, run deterministic lanes with `npm run devns -- lanes run --feature <id> --write --json`.
5. Use the `devns-code-reviewer` subagent with `reviewSubagent.prompt`, or run the configured review lane.
6. If review or lanes block, send a focused repair prompt back to the implementation subagent.
7. Record evidence/history, run `devns complete`, and create one feature commit.

## Rules

- Do not mark a feature `done` without evidence.
- Do not mix multiple feature IDs in one commit.
- Do not claim a new feature while the active feature has unresolved blocking evidence.
- Do not claim or implement a feature without an approved RFC.
- If requirements are ambiguous before implementation, use `devns-rfc`.
- Do not manually run the Stop hook as the normal continuation mechanism. Stop hooks are safety nets.
- Do not assume two Stop hooks form a serial pipeline.
- DEVNS is not an LLM provider. Claude subagents are configured in `.claude/agents/*.md` and should be invoked explicitly from the orchestrator packet.
