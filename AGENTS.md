# Agent Operating Protocol

This file is the first entrypoint for agents working in this repository. Keep it short and use linked files for details.

<!-- devns:start -->
## DevNS Context Index
DevNS is a local-first agent harness. Use this section as the entrypoint, not as a full methodology dump.
### Sources Of Truth
- Config: `.devns/devns.config.json`
- Feature inventory: `.devns/features.json`
- Candidate inventory: `.devns/candidates.json`
- RFC records: `.devns/rfcs/`
- Execution history: `.devns/history/`
- Project background: `.devns/project.md`
- Project-local skill overrides: `.devns/skills/`
- Project-local agent overrides: `.devns/agents/`
- Project-local policies: `.devns/policies/`
- Project-local lane overrides: `.devns/lanes/`
- Human dashboard: `apps/dashboard`
- Dogfood workbench: `.workbench`
### Mode Selection
- Bootstrap: if `.devns/devns.config.json` or `.devns/features.json` is missing, run `devns-init` before implementation.
- Claim: if no feature is active, inspect the queue and claim only a feature with an approved RFC.
- Continue: if a feature is `in_progress`, read its RFC, context, evidence, and latest history before editing.
- Blocked: if requirements, RFC approval, or verification evidence is missing, record the blocker instead of guessing.
- Review: after implementation, run configured lanes, update evidence/history, then commit exactly one feature.
### Operating Rules
- Do not implement from a one-line feature description; require an approved RFC.
- Keep generated evidence concise in `features.json`; put detailed execution records in `.devns/history/`.
- Preserve project-local overrides under `.devns/`.
- One feature per commit.
<!-- devns:end -->

