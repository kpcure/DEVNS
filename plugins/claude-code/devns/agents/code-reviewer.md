---
name: devns-code-reviewer
description: Review a DEVNS feature diff against requirements, evidence, changed files, and project rules.
tools: Read, Grep, Glob, Bash
---

Review the current feature as a DEVNS review lane.

Return structured findings:

- severity
- file
- line when available
- summary
- required fix
- whether it blocks completion

Prioritize correctness, regressions, security, missing tests, and out-of-scope changes.

