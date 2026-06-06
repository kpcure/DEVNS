#!/usr/bin/env node
import { access } from "node:fs/promises";
import { evaluateRfcReadiness } from "../harness/rfc";
import { orchestrationPacket, type OrchestratorHost } from "../harness/orchestration";
import { activeFeature, blockedReadyFeature, claimFeature, nextFeature, TaskQueueError } from "../harness/task-queue";
import { readConfig, readInventory } from "../harness/state";

type Options = {
  output: "json" | "text";
  claim: boolean;
  by: string;
  host: OrchestratorHost;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    output: "text",
    claim: true,
    by: "devns-orchestrator",
    host: "generic"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--no-claim") {
      options.claim = false;
    } else if (arg === "--by") {
      options.by = argv[index + 1] || options.by;
      index += 1;
    } else if (arg === "--host") {
      const host = argv[index + 1] as OrchestratorHost | undefined;
      if (host && ["generic", "claude", "codex"].includes(host)) {
        options.host = host;
      }
      index += 1;
    }
  }

  return options;
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeText(packet: ReturnType<typeof orchestrationPacket>) {
  const lines = [
    `Mode: ${packet.mode}`,
    `Host: ${packet.host}`,
    `Stop hook: ${packet.stopHookRole}`,
    packet.featureId ? `Feature: ${packet.featureId} - ${packet.title}` : undefined,
    packet.implementationSubagent ? `Implementation: ${packet.implementationSubagent.launchInstruction}` : undefined,
    packet.reviewSubagent ? `Review: ${packet.reviewSubagent.launchInstruction}` : undefined,
    packet.reasons.length ? `Reasons:\n${packet.reasons.map((reason) => `- ${reason}`).join("\n")}` : undefined,
    packet.mode === "empty_queue" ? "No claimable feature remains." : undefined
  ].filter(Boolean);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!(await exists(".devns/devns.config.json")) || !(await exists(".devns/features.json"))) {
    const payload = orchestrationPacket({
      mode: "bootstrap_required",
      host: options.host,
      cwd,
      reasons: ["DEVNS workspace is missing. Run devns-init before implementation."]
    });
    options.output === "json" ? writeJson(payload) : writeText(payload);
    return;
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const active = await activeFeature(cwd, config);

  if (active) {
    const payload = orchestrationPacket({
      mode: "continue_active",
      host: options.host,
      cwd,
      config,
      feature: active
    });
    options.output === "json" ? writeJson(payload) : writeText(payload);
    return;
  }

  const next = await nextFeature(cwd, config);
  if (next) {
    const result = options.claim
      ? await claimFeature(cwd, config, next.id, {
          by: options.by,
          summary: "Claimed by DEVNS orchestrator"
        })
      : undefined;
    const feature = result?.feature ?? next;
    const payload = orchestrationPacket({
      mode: "claim_next",
      host: options.host,
      cwd,
      config,
      feature,
      claimed: Boolean(result)
    });
    options.output === "json" ? writeJson(payload) : writeText(payload);
    return;
  }

  const blocked = await blockedReadyFeature(cwd, config);
  if (blocked) {
    const reasons = blocked.readiness.ready ? [] : blocked.readiness.reasons;
    const payload = orchestrationPacket({
      mode: "blocked_ready",
      host: options.host,
      cwd,
      config,
      feature: blocked.feature,
      reasons
    });
    options.output === "json" ? writeJson(payload) : writeText(payload);
    return;
  }

  const missingRfcCount = inventory.features.filter((feature) => !evaluateRfcReadiness(feature).ready).length;
  const payload = orchestrationPacket({
    mode: "empty_queue",
    host: options.host,
    cwd,
    summary: {
      total: inventory.features.length,
      missingRfc: missingRfcCount
    },
    reasons:
      missingRfcCount > 0
        ? ["No claimable feature remains. Some features still need RFC clarification."]
        : ["No claimable feature remains. It is safe for the orchestrator to stop."]
  });
  options.output === "json" ? writeJson(payload) : writeText(payload);
}

main().catch((error) => {
  if (error instanceof TaskQueueError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  process.stderr.write(`${error instanceof Error ? error.message : "Unknown orchestrator command error"}\n`);
  process.exitCode = 1;
});
