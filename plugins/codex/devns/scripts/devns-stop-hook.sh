#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${DEVNS_PROJECT_DIR:-${CODEX_PROJECT_DIR:-${PWD}}}"

log_adapter() {
  local phase="$1"
  local command="${2:-}"
  local log_dir="$PROJECT_DIR/.devns/history"
  mkdir -p "$log_dir" 2>/dev/null || true
  DEVNS_LOG_PHASE="$phase" DEVNS_LOG_COMMAND="$command" DEVNS_LOG_PROJECT_DIR="$PROJECT_DIR" node <<'NODE' >> "$log_dir/stop-hook.jsonl" 2>/dev/null || true
const event = {
  ts: new Date().toISOString(),
  source: "adapter",
  phase: process.env.DEVNS_LOG_PHASE,
  cwd: process.env.DEVNS_LOG_PROJECT_DIR,
  command: process.env.DEVNS_LOG_COMMAND || undefined
};
process.stdout.write(`${JSON.stringify(event)}\n`);
NODE
}

log_adapter "start"

has_npm_script() {
  local script_name="$1"
  [[ -f "$PROJECT_DIR/package.json" ]] || return 1
  node -e 'const fs = require("fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(pkg.scripts && pkg.scripts[process.argv[2]] ? 0 : 1);' "$PROJECT_DIR/package.json" "$script_name" 2>/dev/null
}

if [[ -n "${DEVNS_STOP_COMMAND:-}" ]]; then
  cd "$PROJECT_DIR"
  log_adapter "exec" "$DEVNS_STOP_COMMAND"
  exec bash -lc "$DEVNS_STOP_COMMAND"
fi

if has_npm_script "devns:stop"; then
  log_adapter "exec" "npm --prefix $PROJECT_DIR run devns:stop --silent"
  exec npm --prefix "$PROJECT_DIR" run devns:stop --silent
fi

if has_npm_script "harness:stop"; then
  log_adapter "exec" "npm --prefix $PROJECT_DIR run harness:stop --silent"
  exec npm --prefix "$PROJECT_DIR" run harness:stop --silent
fi

log_adapter "missing_command"
printf '%s' '{"decision":"block","reason":"DEVNS stop hook could not find a stop command. Add npm script devns:stop or set DEVNS_STOP_COMMAND."}'
