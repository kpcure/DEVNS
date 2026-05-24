#!/usr/bin/env node
import { evaluateRfcReadiness } from "../harness/rfc";
import { activeFeature, blockedReadyFeature, claimFeature, nextFeature, TaskQueueError } from "../harness/task-queue";
import { readConfig, readInventory } from "../harness/state";

type QueueCommand = "status" | "next" | "claim";

type QueueOptions = {
  command?: QueueCommand;
  id?: string;
  output: "json" | "text";
  by?: string;
};

function parseArgs(argv: string[]): QueueOptions {
  const options: QueueOptions = {
    command: argv[0] as QueueCommand | undefined,
    output: "text",
    by: "devns-cli"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--by") {
      options.by = argv[index + 1] || options.by;
      index += 1;
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run devns:queue -- status [--json]",
      "  npm run devns:queue -- next [--json]",
      "  npm run devns:queue -- claim [--id <feature-id>] [--json]"
    ].join("\n") + "\n"
  );
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function summarize(features: Awaited<ReturnType<typeof readInventory>>["features"]) {
  const total = features.length;
  const byStatus = features.reduce<Record<string, number>>((acc, feature) => {
    acc[feature.status] = (acc[feature.status] ?? 0) + 1;
    return acc;
  }, {});
  const rfcReady = features.filter((feature) => evaluateRfcReadiness(feature).ready).length;
  const claimable = features.filter((feature) => feature.status === "ready" && evaluateRfcReadiness(feature).ready).length;

  return { total, byStatus, rfcReady, claimable };
}

async function status(cwd: string, output: QueueOptions["output"]) {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const active = await activeFeature(cwd, config);
  const next = await nextFeature(cwd, config);
  const blocked = await blockedReadyFeature(cwd, config);
  const payload = {
    project: inventory.project,
    revision: inventory.revision,
    summary: summarize(inventory.features),
    active,
    next,
    blockedReady: blocked
      ? {
          feature: blocked.feature,
          reasons: blocked.readiness.ready ? [] : blocked.readiness.reasons
        }
      : undefined
  };

  if (output === "json") {
    writeJson(payload);
    return;
  }

  process.stdout.write(
    [
      `${inventory.project.name}`,
      `Features: ${payload.summary.total}`,
      `Active: ${active ? `${active.id} ${active.title}` : "none"}`,
      `Next claimable: ${next ? `${next.id} ${next.title}` : "none"}`,
      `Claimable ready: ${payload.summary.claimable}`,
      blocked ? `Blocked ready example: ${blocked.feature.id} ${blocked.readiness.ready ? "" : blocked.readiness.reasons[0]}` : ""
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

async function next(cwd: string, output: QueueOptions["output"]) {
  const config = await readConfig(cwd);
  const feature = await nextFeature(cwd, config);
  const blocked = feature ? undefined : await blockedReadyFeature(cwd, config);

  if (output === "json") {
    writeJson({
      feature,
      blockedReady: blocked
        ? {
            feature: blocked.feature,
            reasons: blocked.readiness.ready ? [] : blocked.readiness.reasons
          }
        : undefined
    });
    return;
  }

  if (feature) {
    process.stdout.write(`Next: ${feature.id} ${feature.title}\n`);
    return;
  }

  if (blocked) {
    process.stdout.write(
      [`No claimable feature. Ready feature ${blocked.feature.id} is blocked:`, ...(blocked.readiness.ready ? [] : blocked.readiness.reasons.map((reason) => `- ${reason}`))].join("\n") + "\n"
    );
    return;
  }

  process.stdout.write("No claimable feature.\n");
}

async function claim(cwd: string, options: QueueOptions) {
  const config = await readConfig(cwd);
  const result = await claimFeature(cwd, config, options.id, {
    by: options.by,
    summary: options.id ? `Claimed ${options.id} from CLI` : "Claimed next feature from CLI"
  });

  if (options.output === "json") {
    writeJson(result ? { feature: result.feature, revision: result.revision } : { feature: undefined });
    return;
  }

  if (!result) {
    process.stdout.write("No claimable feature.\n");
    return;
  }

  process.stdout.write(`Claimed: ${result.feature.id} ${result.feature.title}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!options.command || !["status", "next", "claim"].includes(options.command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.command === "status") {
    await status(cwd, options.output);
  } else if (options.command === "next") {
    await next(cwd, options.output);
  } else {
    await claim(cwd, options);
  }
}

main().catch((error) => {
  if (error instanceof TaskQueueError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  process.stderr.write(`${error instanceof Error ? error.message : "Unknown queue command error"}\n`);
  process.exitCode = 1;
});
