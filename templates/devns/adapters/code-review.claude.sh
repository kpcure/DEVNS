#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEVNS_REVIEW_PROMPT:-}" || ! -f "$DEVNS_REVIEW_PROMPT" ]]; then
  echo "DEVNS_REVIEW_PROMPT is missing or unreadable" >&2
  exit 1
fi

REPO="${DEVNS_REPO:-$PWD}"
(
  cd "$REPO"
  DEVNS_STOP_COMMAND=true claude -p < "$DEVNS_REVIEW_PROMPT"
)
