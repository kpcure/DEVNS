# Contributing

Thanks for helping improve DEVNS.

## Local Checks

Run these before opening a pull request:

```sh
npm ci
npm run build
npm run smoke
npx tsc --noEmit --pretty false
```

## Command Changes

When adding or changing a `devns` command:

- Keep `devns` as the user-facing entrypoint.
- Update `packages/core/src/cli/devns.ts` usage text.
- Add or update a focused smoke script.
- Update `docs/command-surface.md`.
- Prefer structured JSON output for Agent consumption.

## Harness Rules

- Do not implement from a one-line candidate; executable work needs an approved RFC.
- Evidence must describe what it proves and, when possible, which acceptance criteria or requirements it covers.
- Review agents are read-only evidence producers. They should not edit files or commit.
- Keep `features.json` compact; detailed execution records belong in `.devns/history/`.

