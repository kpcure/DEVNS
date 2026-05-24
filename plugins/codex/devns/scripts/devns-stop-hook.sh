#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${DEVNS_PROJECT_DIR:-${CODEX_PROJECT_DIR:-${PWD}}}"

if [[ -n "${DEVNS_STOP_COMMAND:-}" ]]; then
  cd "$PROJECT_DIR"
  exec bash -lc "$DEVNS_STOP_COMMAND"
fi

if [[ -f "$PROJECT_DIR/package.json" ]] && npm --prefix "$PROJECT_DIR" run | grep -qE '(^| )devns:stop($| )'; then
  exec npm --prefix "$PROJECT_DIR" run devns:stop --silent
fi

if [[ -f "$PROJECT_DIR/package.json" ]] && npm --prefix "$PROJECT_DIR" run | grep -qE '(^| )harness:stop($| )'; then
  exec npm --prefix "$PROJECT_DIR" run harness:stop --silent
fi

printf '%s' '{"decision":"block","reason":"DevNS stop hook could not find a stop command. Add npm script devns:stop or set DEVNS_STOP_COMMAND."}'
