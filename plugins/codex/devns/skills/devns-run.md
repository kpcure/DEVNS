# DEVNS Run

Use this workflow in repositories configured with DEVNS.

If you are unsure what to do, check the workspace first:

```sh
npx @kpcure/devns doctor --json
```

Start by running the orchestrator command surface:

```sh
npx @kpcure/devns orchestrate --host codex --json
```

Then follow the returned mode:

1. `bootstrap_required`: run `devns-init` before implementation.
2. `continue_active`: keep the main agent as orchestrator and launch the implementation/review subagents from the packet.
3. `claim_next`: use the returned implementation subagent prompt for exactly one approved feature.
4. `blocked_ready`: run `devns-rfc` or ask for human RFC approval.
5. `empty_queue`: stop unless the human adds new candidates or features.

Inside one feature loop:

1. Read the approved RFC and linked context.
2. Main agent does not implement product code by default.
3. Explicitly spawn the `devns_feature_worker` custom agent with `implementationSubagent.prompt`.
4. When the worker returns, run deterministic lanes with `npm run devns -- lanes run --feature <id> --write --json`.
5. Explicitly spawn the `devns_code_reviewer` custom agent with `reviewSubagent.prompt`, or run the configured review lane.
6. If review or lanes block, send a focused repair prompt back to the implementation subagent.
7. Record evidence/history, run `devns complete`, and commit exactly one feature.

DEVNS is extension-first: project-local skills, agents, sensors, and hook policies override defaults.

## Hook Boundary

- Do not manually run the stop hook as the normal continuation mechanism. Stop hooks are safety nets.
- Do not assume two Stop hooks form a serial pipeline.
- DEVNS is not an LLM provider. Codex custom agents are configured in `.codex/agents/*.toml` and must be explicitly requested by the parent prompt.
