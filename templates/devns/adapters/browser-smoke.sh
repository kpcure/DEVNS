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
export DEVNS_BROWSER_SMOKE_ARTIFACT_DIR="$OUT_DIR"
export DEVNS_BROWSER_SMOKE_ARTIFACT_ABS_DIR="$ABS_OUT_DIR"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
(
  cd "$ROOT"
  bash -lc "$COMMAND"
) >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e
COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node - "$REPORT_FILE" "$COMMAND" "$EXIT_CODE" "$STARTED_AT" "$COMPLETED_AT" "$OUT_DIR" "$ABS_OUT_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [reportFile, command, exitCode, startedAt, completedAt, outDir, absOutDir] = process.argv.slice(2);
const excluded = new Set(["run.json", "stdout.log", "stderr.log"]);

function walk(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute, relative);
    if (!entry.isFile() || excluded.has(relative)) return [];
    return [{ relative, absolute }];
  });
}

function kindFor(file) {
  const lower = file.toLowerCase();
  const textLike = /\.(txt|text|html?|json|jsonl|ndjson|ya?ml)$/.test(lower);
  if (/\.(png|jpe?g|webp)$/.test(lower)) return "screenshot";
  if (/trace.*\.zip$/.test(lower) || /\.trace\.zip$/.test(lower)) return "trace";
  if (/console.*\.(ndjson|jsonl|json)$/.test(lower)) return "console";
  if (/(network|requests?|har).*\.(ndjson|jsonl|json|har)$/.test(lower)) return "network";
  if (textLike && /(^|[/._-])(dom|visible[-_]?text|page[-_]?text|text[-_]?snapshot|dom[-_]?snapshot)([/._-]|$)/.test(lower)) return "dom_snapshot";
  if (textLike && /(^|[/._-])(accessibility|a11y|aria)([/._-]|$)/.test(lower)) return "accessibility_snapshot";
  if (textLike && /(^|[/._-])ocr([/._-]|$)/.test(lower)) return "ocr_text";
  if (/\.(webm|mp4|mov)$/.test(lower)) return "video";
  if (/\.log$/.test(lower)) return "log";
  return "other";
}

const artifacts = walk(absOutDir).map((item) => ({
  kind: kindFor(item.relative),
  path: `${outDir}/${item.relative}`,
  bytes: fs.statSync(item.absolute).size
}));

const report = {
  schemaVersion: 1,
  type: "browser_smoke",
  command,
  exitCode: Number(exitCode),
  startedAt,
  completedAt,
  artifactDir: outDir,
  stdout: `${outDir}/stdout.log`,
  stderr: `${outDir}/stderr.log`,
  artifacts
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
for (const artifact of artifacts) {
  console.log(`DEVNS_ARTIFACT=${artifact.path}`);
}
NODE

echo "DEVNS_ARTIFACT=$OUT_DIR/run.json"
echo "DEVNS_ARTIFACT=$OUT_DIR/stdout.log"
echo "DEVNS_ARTIFACT=$OUT_DIR/stderr.log"
exit "$EXIT_CODE"
