#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEVNS_REVIEW_PROMPT:-}" || ! -f "$DEVNS_REVIEW_PROMPT" ]]; then
  echo "DEVNS_REVIEW_PROMPT is missing or unreadable" >&2
  exit 1
fi

REPO="${DEVNS_REPO:-$PWD}"
OUT="$(mktemp "${TMPDIR:-/tmp}/devns-codex-review.XXXXXX.json")"
cleanup() {
  rm -f "$OUT"
}
trap cleanup EXIT

# Prevent nested Codex exec sessions from recursively running the project's stop hook.
DEVNS_STOP_COMMAND=true codex exec \
  --cd "$REPO" \
  --sandbox read-only \
  --ask-for-approval never \
  --output-last-message "$OUT" \
  < "$DEVNS_REVIEW_PROMPT" >/dev/null

node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8").trim();
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start === -1 || end <= start) {
  console.error("Codex review output did not contain a JSON object.");
  process.exit(1);
}
process.stdout.write(raw.slice(start, end + 1));
' "$OUT"
