#!/usr/bin/env node
import { readStopHookTrace, stopHookLogPath } from "../harness/stop-log";

function parseArgs(argv: string[]) {
  const options = {
    json: false,
    limit: 20
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--tail" || arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value >= 0) {
        options.limit = value;
      }
      index += 1;
    }
  }

  return options;
}

async function main() {
  const cwd = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const records = await readStopHookTrace(cwd, options.limit);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ path: stopHookLogPath(cwd), records }, null, 2)}\n`);
    return;
  }

  if (!records.length) {
    process.stdout.write(`No DEVNS stop hook trace found at ${stopHookLogPath(cwd)}\n`);
    return;
  }

  for (const record of records) {
    const parts = [
      record.ts,
      record.source,
      record.phase,
      record.mode,
      record.decision,
      record.selectedFeatureId ? `feature=${record.selectedFeatureId}` : undefined
    ].filter(Boolean);
    process.stdout.write(`${parts.join(" | ")}\n`);
    if (record.reason) {
      process.stdout.write(`  ${record.reason}\n`);
    }
    if (record.command) {
      process.stdout.write(`  command: ${record.command}\n`);
    }
    if (record.error) {
      process.stdout.write(`  error: ${record.error}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown stop-log error"}\n`);
  process.exitCode = 1;
});

