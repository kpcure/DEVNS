#!/usr/bin/env node
import { evaluateClaudeStopHook } from "../harness/claude-stop";
import { safeAppendStopHookTrace } from "../harness/stop-log";
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
  let input: ClaudeStopHookInput;
  try {
    input = raw ? (JSON.parse(raw) as ClaudeStopHookInput) : {};
  } catch (error) {
    await safeAppendStopHookTrace(process.cwd(), {
      source: "cli",
      phase: "parse_error",
      error: error instanceof Error ? error.message : "Unknown JSON parse error"
    });
    throw error;
  }
  const result = await evaluateClaudeStopHook(input);

  if (result.decision === "block") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason }));
    return;
  }

  process.exitCode = 0;
}

main().catch(async (error) => {
  await safeAppendStopHookTrace(process.cwd(), {
    source: "cli",
    phase: "error",
    error: error instanceof Error ? error.message : "Unknown error"
  });
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: `DEVNS stop hook failed: ${error instanceof Error ? error.message : "Unknown error"}`
    })
  );
});
