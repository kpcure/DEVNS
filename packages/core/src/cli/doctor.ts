#!/usr/bin/env node
import { access } from "node:fs/promises";
import { activeFeature, blockedReadyFeature, nextFeature } from "../harness/task-queue";
import { readConfig, readInventory } from "../harness/state";

type DoctorMode = "bootstrap_required" | "continue_active" | "claim_next" | "blocked_ready" | "empty_queue";

type DoctorCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type DoctorOptions = {
  output: "json" | "text";
};

function parseArgs(argv: string[]): DoctorOptions {
  return {
    output: argv.includes("--json") ? "json" : "text"
  };
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

function writeText(payload: {
  mode: DoctorMode;
  nextAction: string;
  checks: DoctorCheck[];
  active?: unknown;
  next?: unknown;
}) {
  process.stdout.write(
    [
      `Mode: ${payload.mode}`,
      `Next action: ${payload.nextAction}`,
      "",
      "Checks:",
      ...payload.checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`)
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks: DoctorCheck[] = [];

  const hasConfig = await exists(".devns/devns.config.json");
  const hasFeatures = await exists(".devns/features.json");
  checks.push({
    name: ".devns/devns.config.json",
    status: hasConfig ? "pass" : "fail",
    detail: hasConfig ? "workspace config exists" : "run devns-init before implementation"
  });
  checks.push({
    name: ".devns/features.json",
    status: hasFeatures ? "pass" : "fail",
    detail: hasFeatures ? "feature inventory exists" : "run devns-init before implementation"
  });

  if (!hasConfig || !hasFeatures) {
    const payload = {
      mode: "bootstrap_required" as const,
      nextAction: "Run npx devns init, then use the devns-init skill to discover candidate features.",
      checks
    };
    options.output === "json" ? writeJson(payload) : writeText(payload);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  checks.push({
    name: "feature inventory schema",
    status: "pass",
    detail: `${inventory.features.length} feature(s) loaded`
  });

  const active = await activeFeature(cwd, config);
  const next = await nextFeature(cwd, config);
  const blocked = await blockedReadyFeature(cwd, config);

  let mode: DoctorMode;
  let nextAction: string;

  if (active) {
    mode = "continue_active";
    nextAction = `Continue ${active.id}. Read the approved RFC, finish verification, update evidence/history, and commit exactly this feature.`;
  } else if (next) {
    mode = "claim_next";
    nextAction = `Claim ${next.id} with npx devns run --json, or inspect it first with npx devns queue next --json.`;
  } else if (blocked) {
    mode = "blocked_ready";
    nextAction = `Clarify or approve the RFC for ${blocked.feature.id} before implementation.`;
  } else {
    mode = "empty_queue";
    nextAction = "No claimable feature remains. Add candidates, run RFC clarification, or stop.";
  }

  const payload = {
    mode,
    nextAction,
    project: inventory.project,
    checks,
    active,
    next,
    blockedReady: blocked
      ? {
          feature: blocked.feature,
          reasons: blocked.readiness.ready ? [] : blocked.readiness.reasons
        }
      : undefined
  };

  options.output === "json" ? writeJson(payload) : writeText(payload);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown DEVNS doctor error"}\n`);
  process.exitCode = 1;
});
