#!/usr/bin/env bash
set -euo pipefail

COMMAND="${DEVNS_BROWSER_SMOKE_COMMAND:-${*:-}}"
if [[ -z "$COMMAND" ]]; then
  echo "DEVNS_BROWSER_SMOKE_COMMAND is required, for example: DEVNS_BROWSER_SMOKE_COMMAND='npx playwright test' bash .devns/adapters/browser-smoke.sh" >&2
  exit 2
fi

ROOT="${DEVNS_REPO:-$PWD}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${DEVNS_BROWSER_SMOKE_ARTIFACT_DIR:-.devns/artifacts/browser-smoke/$STAMP}"
ABS_OUT_DIR="$ROOT/$OUT_DIR"
STDOUT_FILE="$ABS_OUT_DIR/stdout.log"
STDERR_FILE="$ABS_OUT_DIR/stderr.log"
REPORT_FILE="$ABS_OUT_DIR/run.json"

mkdir -p "$ABS_OUT_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
(
  cd "$ROOT"
  bash -lc "$COMMAND"
) >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e
COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node - "$REPORT_FILE" "$COMMAND" "$EXIT_CODE" "$STARTED_AT" "$COMPLETED_AT" "$OUT_DIR" <<'NODE'
const fs = require("node:fs");
const [reportFile, command, exitCode, startedAt, completedAt, outDir] = process.argv.slice(2);
const report = {
  schemaVersion: 1,
  type: "browser_smoke",
  command,
  exitCode: Number(exitCode),
  startedAt,
  completedAt,
  artifactDir: outDir,
  stdout: `${outDir}/stdout.log`,
  stderr: `${outDir}/stderr.log`
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
NODE

echo "DEVNS_ARTIFACT=$OUT_DIR/run.json"
echo "DEVNS_ARTIFACT=$OUT_DIR/stdout.log"
echo "DEVNS_ARTIFACT=$OUT_DIR/stderr.log"
exit "$EXIT_CODE"
