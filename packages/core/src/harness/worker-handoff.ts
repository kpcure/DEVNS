import { historyPathForFeature } from "./history";
import type { DevnsConfig, Feature } from "./types";

export function workerHandoff(config: DevnsConfig, feature: Feature, cwd = process.cwd()) {
  const inferredChangedFilePlan = feature.implementationSurface?.length
    ? feature.implementationSurface
    : feature.changedFiles?.length
      ? feature.changedFiles
      : [];
  return {
    strategy: "prefer_isolated_worker",
    scope: "exactly_one_feature",
    featureId: feature.id,
    implementationTitle: feature.rfc?.summary ?? feature.title,
    expectedOutcome: feature.rfc?.expectedOutcome ?? feature.description,
    domainConstraints: [...(feature.rfc?.goals ?? []), ...(feature.rfc?.nonGoals ?? []).map((item) => `Non-goal: ${item}`)],
    rfc: feature.rfc ?? null,
    historyPath: feature.history?.historyPath ?? historyPathForFeature(cwd, config, feature.id),
    context: feature.context ?? [],
    contextSources: feature.context ?? [],
    changedFilePlan: inferredChangedFilePlan,
    implementationPlanning: inferredChangedFilePlan.length
      ? "Use the listed files as the expected implementation surface, then adjust only if repository evidence proves the plan is wrong."
      : "No implementation file plan is known yet. First inspect the repository and RFC, produce a short implementation file plan, then edit only files justified by that plan.",
    validationPlan: feature.rfc?.validationPlan ?? null,
    contextBudget: config.completionPolicy?.contextBudget ?? null,
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

export function featureWorkerPrompt(feature: Feature, verb: "Continue" | "Implement") {
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

export function stopHookWorkerContinuation(config: DevnsConfig, feature: Feature, cwd = process.cwd()) {
  const handoff = workerHandoff(config, feature, cwd);
  return [
    `Claimed next feature ${feature.id}: ${feature.title}.`,
    "Do not implement this feature in the stop-hook orchestration context.",
    "Start a Sub Agent, isolated worker, or fresh implementation context for exactly this one feature now; if the host has no worker support, explicitly reset to a fresh implementation context before editing.",
    `Worker handoff: ${JSON.stringify({
      strategy: handoff.strategy,
      scope: handoff.scope,
      featureId: handoff.featureId,
      implementationTitle: handoff.implementationTitle,
      expectedOutcome: handoff.expectedOutcome,
      historyPath: handoff.historyPath,
      contextSources: handoff.contextSources,
      changedFilePlan: handoff.changedFilePlan,
      implementationPlanning: handoff.implementationPlanning,
      validationPlan: handoff.validationPlan,
      requiredLanes: handoff.requiredLanes,
      expectedOutput: handoff.expectedOutput
    })}`,
    "Main context duty: orchestrate queue state, aggregate evidence, and let the worker return implementation results, blockers, verification output, and suggested commit message."
  ].join("\n");
}
