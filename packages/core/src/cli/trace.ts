#!/usr/bin/env node
import { auditOrchestratorTraces, orchestratorTracePath, readOrchestratorTraces } from "../harness/orchestrator-trace";
import { readConfig } from "../harness/state";

type Options = {
  json: boolean;
  limit: number;
  audit: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    json: false,
    limit: 20,
    audit: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--audit") {
      options.audit = true;
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

function textLine(record: Awaited<ReturnType<typeof readOrchestratorTraces>>[number]) {
  const parts = [
    record.completedAt,
    record.host,
    record.mode,
    record.claimed ? "claimed" : undefined,
    record.featureId ? `feature=${record.featureId}` : undefined,
    `trace=${record.traceId}`
  ].filter(Boolean);
  return parts.join(" | ");
}

async function main() {
  const cwd = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const config = await readConfig(cwd);
  const path = orchestratorTracePath(cwd, config);
  const records = await readOrchestratorTraces(cwd, config, options.limit);
  const audit = options.audit ? auditOrchestratorTraces(records) : undefined;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ path, records, audit }, null, 2)}\n`);
    if (audit?.decision === "fail") {
      process.exitCode = 1;
    }
    return;
  }

  if (!records.length) {
    process.stdout.write(`No DEVNS orchestrator trace found at ${path}\n`);
  } else {
    for (const record of records) {
      process.stdout.write(`${textLine(record)}\n`);
      if (record.reasons.length) {
        process.stdout.write(`  ${record.reasons.join(" ")}\n`);
      }
    }
  }

  if (audit) {
    process.stdout.write(`Audit: ${audit.decision} (${audit.records} record(s), ${audit.findings.length} finding(s))\n`);
    for (const finding of audit.findings) {
      process.stdout.write(`  [${finding.severity}] ${finding.message}\n`);
    }
    if (audit.decision === "fail") {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown trace command error"}\n`);
  process.exitCode = 1;
});
