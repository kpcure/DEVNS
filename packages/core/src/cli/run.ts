#!/usr/bin/env node
import { access } from "node:fs/promises";
import { evaluateRfcReadiness } from "../harness/rfc";
import { historyPathForFeature } from "../harness/history";
import { activeFeature, blockedReadyFeature, claimFeature, nextFeature, TaskQueueError } from "../harness/task-queue";
import { readConfig, readInventory } from "../harness/state";
import type { DevnsConfig, Feature } from "../harness/types";

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

function workerHandoff(config: DevnsConfig, feature: Feature) {
  const inferredChangedFilePlan = feature.changedFiles?.length ? feature.changedFiles : [];
  return {
    strategy: "prefer_isolated_worker",
    scope: "exactly_one_feature",
    featureId: feature.id,
    implementationTitle: feature.rfc?.summary ?? feature.title,
    expectedOutcome: feature.rfc?.expectedOutcome ?? feature.description,
    domainConstraints: [...(feature.rfc?.goals ?? []), ...(feature.rfc?.nonGoals ?? []).map((item) => `Non-goal: ${item}`)],
    rfc: feature.rfc ?? null,
    historyPath: feature.history?.historyPath ?? historyPathForFeature(process.cwd(), config, feature.id),
    context: feature.context ?? [],
    contextSources: feature.context ?? [],
    changedFilePlan: inferredChangedFilePlan,
    implementationPlanning: inferredChangedFilePlan.length
      ? "Use the listed files as the expected implementation surface, then adjust only if repository evidence proves the plan is wrong."
      : "No implementation file plan is known yet. First inspect the repository and RFC, produce a short implementation file plan, then edit only files justified by that plan.",
    validationPlan: feature.rfc?.validationPlan ?? null,
    requiredLanes: (config.reviewLanes ?? [])
      .filter((lane) => lane.required || lane.blocksCompletion)
      .map((lane) => lane.id),
    promptContracts: [
      "docs/prompt-contracts.md",
      "plugins/codex/devns/prompts/code-review-lane.md",
      "plugins/codex/devns/prompts/domain-knowledge-curator.md"
    ],
    expectedOutput: [
      "changed files and diff summary",
      "commands run and lane evidence",
      "decisions, rejected alternatives, pitfalls, errors, fixes, and lessons",
      "blockers or human-review questions",
      "suggested commit message"
    ]
  };
}

function featurePrompt(feature: Feature, verb: "Continue" | "Implement") {
  return [
    `Expected outcome: ${feature.rfc?.expectedOutcome ?? feature.description}.`,
    `${verb} feature ${feature.id}: ${feature.title}.`,
    "Read its approved RFC, context files, and latest evidence before editing.",
    "After RFC clarification, prefer an isolated worker/subagent or fresh context for this single feature when the host supports it.",
    "Keep the main context responsible for orchestration, evidence aggregation, and stop-hook decisions.",
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
      workerHandoff: workerHandoff(config, active),
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
      workerHandoff: workerHandoff(config, feature),
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
