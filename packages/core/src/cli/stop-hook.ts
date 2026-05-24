#!/usr/bin/env node
import { evaluateClaudeStopHook } from "../harness/claude-stop";
import type { ClaudeStopHookInput } from "../harness/types";

async function readStdin() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw.trim();
}

async function main() {
  const raw = await readStdin();
  const input = raw ? (JSON.parse(raw) as ClaudeStopHookInput) : {};
  const result = await evaluateClaudeStopHook(input);

  if (result.decision === "block") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason }));
    return;
  }

  process.exitCode = 0;
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `DevNS stop hook failed: ${error instanceof Error ? error.message : "Unknown error"}`
    })
  );
});
