#!/usr/bin/env node
import { access } from "node:fs/promises";
import { evaluateRfcReadiness } from "../harness/rfc";
import { activeFeature, blockedReadyFeature, claimFeature, nextFeature, TaskQueueError } from "../harness/task-queue";
import { readConfig, readInventory } from "../harness/state";
import type { Feature } from "../harness/types";

type RunMode = "bootstrap_required" | "continue_active" | "claim_next" | "blocked_ready" | "empty_queue";

type RunOptions = {
  output: "json" | "text";
  claim: boolean;
  by: string;
};

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = {
    output: "text",
    claim: true,
    by: "devns-run"
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

function featurePrompt(feature: Feature, verb: "Continue" | "Implement") {
  return [
    `${verb} feature ${feature.id}: ${feature.title}.`,
    "Read its approved RFC, context files, and latest evidence before editing.",
    "Do technical implementation analysis inside the feature loop.",
    "Implement the smallest coherent change, run verification, update evidence/history, then commit exactly this feature."
  ].join(" ");
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeText(mode: RunMode, prompt: string) {
  process.stdout.write([`Mode: ${mode}`, prompt].join("\n") + "\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!(await exists(".devns/devns.config.json")) || !(await exists(".devns/features.json"))) {
    const payload = {
      mode: "bootstrap_required" as const,
      prompt: "DEVNS workspace is missing. Run devns-init before implementation."
    };
    options.output === "json" ? writeJson(payload) : writeText(payload.mode, payload.prompt);
    return;
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const active = await activeFeature(cwd, config);

  if (active) {
    const payload = {
      mode: "continue_active" as const,
      feature: active,
      prompt: featurePrompt(active, "Continue")
    };
    options.output === "json" ? writeJson(payload) : writeText(payload.mode, payload.prompt);
    return;
  }

  const next = await nextFeature(cwd, config);
  if (next) {
    const result = options.claim
      ? await claimFeature(cwd, config, next.id, {
          by: options.by,
          summary: "Claimed by devns run"
        })
      : undefined;
    const feature = result?.feature ?? next;
    const payload = {
      mode: "claim_next" as const,
      claimed: Boolean(result),
      feature,
      prompt: featurePrompt(feature, "Implement")
    };
    options.output === "json" ? writeJson(payload) : writeText(payload.mode, payload.prompt);
    return;
  }

  const blocked = await blockedReadyFeature(cwd, config);
  if (blocked) {
    const reasons = blocked.readiness.ready ? [] : blocked.readiness.reasons;
    const payload = {
      mode: "blocked_ready" as const,
      feature: blocked.feature,
      reasons,
      prompt: [
        `Ready feature ${blocked.feature.id} is blocked by RFC readiness.`,
        ...reasons.map((reason) => `- ${reason}`),
        "Run devns-rfc or ask the human to approve/update the RFC before implementation."
      ].join("\n")
    };
    options.output === "json" ? writeJson(payload) : writeText(payload.mode, payload.prompt);
    return;
  }

  const missingRfcCount = inventory.features.filter((feature) => !evaluateRfcReadiness(feature).ready).length;
  const payload = {
    mode: "empty_queue" as const,
    summary: {
      total: inventory.features.length,
      missingRfc: missingRfcCount
    },
    prompt:
      missingRfcCount > 0
        ? "No claimable feature remains. Some features still need RFC clarification."
        : "No claimable feature remains. It is safe for the agent to stop."
  };
  options.output === "json" ? writeJson(payload) : writeText(payload.mode, payload.prompt);
}

main().catch((error) => {
  if (error instanceof TaskQueueError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  process.stderr.write(`${error instanceof Error ? error.message : "Unknown run command error"}\n`);
  process.exitCode = 1;
});
