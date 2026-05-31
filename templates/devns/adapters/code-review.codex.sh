#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEVNS_REVIEW_PROMPT:-}" || ! -f "$DEVNS_REVIEW_PROMPT" ]]; then
  echo "DEVNS_REVIEW_PROMPT is missing or unreadable" >&2
  exit 1
fi

codex exec --json < "$DEVNS_REVIEW_PROMPT"
