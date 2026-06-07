# Orchestrator Mode

DEVNS should use Orchestrator Mode as the normal long-run execution model.

In this mode, the current main agent session is the orchestrator. It owns queue state, subagent delegation, evidence aggregation, review routing, completion, and commits. Stop hooks are safety nets, not the primary loop.

## Host Research Summary

Claude Code supports project subagents as Markdown files under `.claude/agents/*.md`, with YAML frontmatter such as `name`, `description`, and `tools`. Claude Code also supports `type: "agent"` hooks, where the hook itself is a prompt-driven subagent and returns Claude's hook JSON shape.

Official docs:

- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/hooks>

Codex supports custom agents under `.codex/agents/*.toml`. Codex only spawns these custom agents when the parent explicitly asks for them, so DEVNS prompts must say to spawn `devns_feature_worker` or `devns_code_reviewer`.

Official docs:

- <https://developers.openai.com/codex/subagents>

## Roles

### Main Agent

The main agent stays in the current session and does not implement product code by default.

Responsibilities:

- run `npx @kpcure/devns doctor --json`
- run `npx @kpcure/devns orchestrate --host <host> --json`
- claim or continue exactly one approved feature
- launch the implementation subagent with the generated worker prompt
- run deterministic lanes after the worker returns
- launch the read-only review subagent or run the configured review lane
- send focused repair prompts back to the worker when review blocks
- record evidence/history
- run `devns complete`
- create exactly one feature commit

### Implementation Subagent

The implementation subagent receives one feature handoff and may edit files.

It must not:

- claim another feature
- complete or commit the feature
- rewrite DEVNS state except when explicitly asked to write evidence through the command surface
- broaden scope beyond the RFC and changed-file plan

### Review Subagent

The review subagent is read-only.

It receives the review packet, RFC, diff, evidence, history, and project rules, then returns one `lane-result` JSON object. The main agent ingests it with:

```sh
npm run devns -- lanes ingest --feature <feature-id> --result <lane-result.json> --actor review-agent:<name> --json
```

## Command

Use:

```sh
npm run devns -- orchestrate --host codex --json
npm run devns -- orchestrate --host claude --json
```

The command returns:

- mode: `bootstrap_required`, `claim_next`, `continue_active`, `blocked_ready`, or `empty_queue`
- stop hook role: `safety_net_only`
- trace summary: `traceId`, `spanId`, path, and event count when a DEVNS workspace exists
- feature context
- worker handoff
- implementation subagent name, launch instruction, and prompt
- review subagent name, launch instruction, and prompt
- main agent next steps

When tracing is enabled, `devns orchestrate` appends one bounded local record to `.devns/traces/orchestrator.jsonl`. The record follows a trace-like workflow shape: trace id, span id, workflow name, host, mode, selected feature, claim status, subagent names, events, reasons, and next-step labels. It does not store worker prompts, review prompts, diffs, model transcripts, or command stdout. Pass `--no-trace` for read-only inspection scripts that must avoid writing diagnostics.

After an implementation worker returns, record a bounded worker result before running lanes:

```sh
npm run devns -- trace worker-result --feature <feature-id> --status implemented --changed-files <n> --commands <n> --artifacts <n> --blockers <n> --json
```

If lanes or review send the feature back for focused repair, record both sides of the loop:

```sh
npm run devns -- trace repair --feature <feature-id> --phase requested --reason "<blocker>" --json
npm run devns -- trace repair --feature <feature-id> --phase result --status implemented --attempt <n> --json
```

Inspect and audit recent traces with:

```sh
npm run devns -- trace --tail 20
npm run devns -- trace --audit --json
```

The audit checks that claim traces include feature selection and claim events, feature orchestration traces include handoff events, empty-queue traces do not select a feature, completed features include lane/review/completion continuity, context reset traces include a later worker result, repair requests include a later repair result, and no prompt/diff/transcript/stdout/stderr markers were stored.

## Installed Subagents

`devns init --host claude` installs:

- `.claude/agents/feature-worker.md`
- `.claude/agents/code-reviewer.md`

`devns init --host codex` installs:

- `.codex/agents/devns_feature_worker.toml`
- `.codex/agents/devns_code_reviewer.toml`

## Stop Hook Boundary

Stop hooks should stay installed as safety nets:

- block unsafe shutdown when a feature is active and gates are missing
- surface continuation reasons if the main agent tries to stop early
- allow stop when no active or claimable work remains

Stop hooks should not be the normal mechanism for claiming the next feature or driving an overnight loop. The loop belongs to the main orchestrator plus per-feature subagents.
