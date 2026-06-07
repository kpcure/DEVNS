#!/usr/bin/env node
import { auditOrchestratorTraces, appendWorkflowTraceSafely, orchestratorTracePath, readOrchestratorTraces } from "../harness/orchestrator-trace";
import { readConfig, readInventory } from "../harness/state";
import type { Feature } from "../harness/types";

type Options = {
  command: "read" | "worker-result" | "repair";
  json: boolean;
  limit: number;
  audit: boolean;
  featureId?: string;
  status?: string;
  phase?: "requested" | "result";
  reason?: string;
  changedFilesCount?: number;
  commandsCount?: number;
  artifactsCount?: number;
  blockersCount?: number;
  attempt?: number;
  traceId?: string;
  parentSpanId?: string;
};

function parseArgs(argv: string[]): Options {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;
  const options: Options = {
    command: command === "worker-result" || command === "repair" ? command : "read",
    json: false,
    limit: 20,
    audit: false
  };

  for (let index = command ? 1 : 0; index < argv.length; index += 1) {
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
    } else if (arg === "--feature" || arg === "--id") {
      options.featureId = argv[index + 1];
      index += 1;
    } else if (arg === "--status") {
      options.status = argv[index + 1];
      index += 1;
    } else if (arg === "--phase") {
      const value = argv[index + 1];
      if (value === "requested" || value === "result") {
        options.phase = value;
      }
      index += 1;
    } else if (arg === "--reason" || arg === "--summary") {
      options.reason = argv[index + 1];
      index += 1;
    } else if (arg === "--changed-files") {
      options.changedFilesCount = numberArg(argv[index + 1]);
      index += 1;
    } else if (arg === "--commands") {
      options.commandsCount = numberArg(argv[index + 1]);
      index += 1;
    } else if (arg === "--artifacts") {
      options.artifactsCount = numberArg(argv[index + 1]);
      index += 1;
    } else if (arg === "--blockers") {
      options.blockersCount = numberArg(argv[index + 1]);
      index += 1;
    } else if (arg === "--attempt") {
      options.attempt = numberArg(argv[index + 1]);
      index += 1;
    } else if (arg === "--trace-id") {
      options.traceId = argv[index + 1];
      index += 1;
    } else if (arg === "--parent-span-id") {
      options.parentSpanId = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function numberArg(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringAttr(value: string | undefined, fallback = "") {
  return value?.trim() || fallback;
}

function acceptedWorkerStatus(value?: string) {
  return value === "implemented" || value === "blocked" || value === "failed" ? value : "implemented";
}

function acceptedRepairStatus(value?: string) {
  return value === "requested" || value === "implemented" || value === "blocked" || value === "failed" ? value : "requested";
}

function findFeature(features: Feature[], featureId?: string) {
  if (!featureId) return undefined;
  return features.find((feature) => feature.id === featureId);
}

function textLine(record: Awaited<ReturnType<typeof readOrchestratorTraces>>[number]) {
  const parts = [
    record.completedAt,
    record.name,
    "host" in record ? record.host : undefined,
    "mode" in record ? record.mode : undefined,
    "claimed" in record && record.claimed ? "claimed" : undefined,
    record.featureId ? `feature=${record.featureId}` : undefined,
    `trace=${record.traceId}`
  ].filter(Boolean);
  return parts.join(" | ");
}

async function selectedFeature(cwd: string, options: Options) {
  if (!options.featureId) {
    throw new Error(`${options.command} requires --feature <id>.`);
  }
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = findFeature(inventory.features, options.featureId);
  if (!feature) {
    throw new Error(`Feature ${options.featureId} not found.`);
  }
  return { config, feature };
}

async function recordWorkerResult(cwd: string, options: Options) {
  const { config, feature } = await selectedFeature(cwd, options);
  const status = acceptedWorkerStatus(options.status);
  const trace = await appendWorkflowTraceSafely(cwd, config, {
    name: "devns.worker.result",
    kind: "agent.workflow",
    traceId: options.traceId,
    parentSpanId: options.parentSpanId,
    featureId: feature.id,
    featureTitle: feature.title,
    events: [
      {
        name: "worker.result",
        attributes: {
          "devns.worker.status": status,
          "devns.changed_files.count": options.changedFilesCount ?? 0,
          "devns.commands.count": options.commandsCount ?? 0,
          "devns.artifacts.count": options.artifactsCount ?? 0,
          "devns.blockers.count": options.blockersCount ?? 0
        }
      }
    ],
    attributes: {
      "devns.command": "trace.worker-result",
      "devns.worker.status": status,
      "devns.feature.id": feature.id
    },
    reasons: options.reason ? [options.reason] : []
  });
  return { featureId: feature.id, trace };
}

async function recordRepair(cwd: string, options: Options) {
  const { config, feature } = await selectedFeature(cwd, options);
  const phase = options.phase ?? "requested";
  const status = options.status ? acceptedRepairStatus(options.status) : phase === "result" ? "implemented" : "requested";
  const trace = await appendWorkflowTraceSafely(cwd, config, {
    name: "devns.repair.loop",
    kind: "agent.workflow",
    traceId: options.traceId,
    parentSpanId: options.parentSpanId,
    featureId: feature.id,
    featureTitle: feature.title,
    events: [
      {
        name: phase === "result" ? "repair.result" : "repair.requested",
        attributes: {
          "devns.repair.phase": phase,
          "devns.repair.status": status,
          "devns.repair.attempt": options.attempt ?? 1,
          "devns.changed_files.count": options.changedFilesCount ?? 0,
          "devns.blockers.count": options.blockersCount ?? 0,
          "devns.repair.reason": stringAttr(options.reason)
        }
      }
    ],
    attributes: {
      "devns.command": "trace.repair",
      "devns.repair.phase": phase,
      "devns.repair.status": status,
      "devns.feature.id": feature.id
    },
    reasons: options.reason ? [options.reason] : []
  });
  return { featureId: feature.id, trace };
}

async function main() {
  const cwd = process.cwd();
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "worker-result") {
    const payload = await recordWorkerResult(cwd, options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Recorded worker result for ${payload.featureId}: ${payload.trace.path}#${payload.trace.traceId}\n`);
    return;
  }

  if (options.command === "repair") {
    const payload = await recordRepair(cwd, options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    process.stdout.write(`Recorded repair trace for ${payload.featureId}: ${payload.trace.path}#${payload.trace.traceId}\n`);
    return;
  }

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
      if (record.reasons?.length) {
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
