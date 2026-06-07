import { historyPathForFeature } from "./history";
import type { ContextBudgetReport } from "./context-budget";
import type { DevnsConfig, Feature } from "./types";

function compactList(values: string[] | undefined, limit = 6) {
  const items = (values ?? []).filter(Boolean);
  return items.length > limit ? [...items.slice(0, limit), `... ${items.length - limit} more`] : items;
}

function rfcContext(feature: Feature) {
  const rfc = feature.rfc;
  return {
    summary: rfc?.summary ?? feature.title,
    background: rfc?.background ?? null,
    featureDescription: rfc?.featureDescription ?? feature.description,
    expectedOutcome: rfc?.expectedOutcome ?? feature.description,
    goals: compactList(rfc?.goals),
    nonGoals: compactList(rfc?.nonGoals),
    requirements: (rfc?.requirements ?? []).slice(0, 8).map((item) => ({
      id: item.id,
      priority: item.priority,
      statement: item.statement
    })),
    acceptanceCriteria: (rfc?.acceptanceCriteria ?? []).slice(0, 8).map((item) => ({
      id: item.id,
      requirementIds: item.requirementIds ?? [],
      statement: item.statement,
      verification: item.verification,
      verificationType: item.verificationType
    })),
    testCases: (rfc?.testCases ?? []).slice(0, 6).map((item) => ({
      id: item.id,
      type: item.type,
      scenario: item.scenario,
      expected: item.expected,
      acceptanceCriteriaIds: item.acceptanceCriteriaIds ?? []
    })),
    validationPlan: rfc?.validationPlan ?? null,
    risks: compactList(rfc?.risks)
  };
}

function laneContext(config: DevnsConfig) {
  return (config.reviewLanes ?? []).map((lane) => ({
    id: lane.id,
    type: lane.type,
    command: lane.command,
    agent: lane.agent,
    required: Boolean(lane.required),
    blocksCompletion: Boolean(lane.blocksCompletion),
    verificationRole:
      lane.type === "agent"
        ? "semantic_review_agent"
        : lane.type === "command"
          ? "deterministic_command"
          : "builtin_static_gate"
  }));
}

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
    rfcContext: rfcContext(feature),
    historyPath: feature.history?.historyPath ?? historyPathForFeature(cwd, config, feature.id),
    context: feature.context ?? [],
    contextSources: feature.context ?? [],
    changedFilePlan: inferredChangedFilePlan,
    implementationPlanning: inferredChangedFilePlan.length
      ? "Use the listed files as the expected implementation surface, then adjust only if repository evidence proves the plan is wrong."
      : "No implementation file plan is known yet. First inspect the repository and RFC, produce a short implementation file plan, then edit only files justified by that plan.",
    validationPlan: feature.rfc?.validationPlan ?? null,
    validationContext: {
      note: "DEVNS validate/harness-validate is deterministic structural validation. Semantic verification requires browser/human/review-agent evidence or an agent review lane.",
      configuredLanes: laneContext(config),
      hasSemanticAgentLane: (config.reviewLanes ?? []).some((lane) => lane.type === "agent"),
      requiredLaneIds: (config.reviewLanes ?? [])
        .filter((lane) => lane.required || lane.blocksCompletion)
        .map((lane) => lane.id)
    },
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
    "Keep the main context responsible for orchestration, evidence aggregation, review routing, completion, and commits. Stop hooks are safety nets.",
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
    "",
    "Feature context:",
    `- Expected outcome: ${handoff.expectedOutcome}`,
    `- Requirements: ${handoff.rfcContext.requirements.map((item) => `${item.id} ${item.statement}`).join(" | ") || "none recorded"}`,
    `- Acceptance criteria: ${handoff.rfcContext.acceptanceCriteria.map((item) => `${item.id} ${item.statement}`).join(" | ") || "none recorded"}`,
    `- Context sources: ${handoff.contextSources.join(", ") || "none recorded; inspect repository before editing"}`,
    `- History path: ${handoff.historyPath}`,
    "",
    "Validation context:",
    `- RFC validation plan: ${JSON.stringify(handoff.rfcContext.validationPlan ?? handoff.validationPlan ?? {})}`,
    `- Configured lanes: ${handoff.validationContext.configuredLanes.map((lane) => `${lane.id}:${lane.type}${lane.command ? `(${lane.command})` : lane.agent ? `(${lane.agent})` : ""}`).join(", ") || "none"}`,
    `- Semantic agent lane configured: ${handoff.validationContext.hasSemanticAgentLane ? "yes" : "no; use review-agent/browser/human evidence for semantic validation"}`,
    "- `devns validate` / `harness:validate` is a structural health check, not a semantic reviewer.",
    "",
    `Worker handoff: ${JSON.stringify({
      strategy: handoff.strategy,
      scope: handoff.scope,
      featureId: handoff.featureId,
      implementationTitle: handoff.implementationTitle,
      expectedOutcome: handoff.expectedOutcome,
      rfcContext: handoff.rfcContext,
      historyPath: handoff.historyPath,
      contextSources: handoff.contextSources,
      changedFilePlan: handoff.changedFilePlan,
      implementationPlanning: handoff.implementationPlanning,
      validationPlan: handoff.validationPlan,
      validationContext: handoff.validationContext,
      requiredLanes: handoff.requiredLanes,
      expectedOutput: handoff.expectedOutput
    })}`,
    "Main context duty: orchestrate queue state, aggregate evidence, and let the worker return implementation results, blockers, verification output, and suggested commit message."
  ].join("\n");
}

export function contextBudgetContinuationLines(report?: ContextBudgetReport) {
  if (!report?.compactHandoffRecommended) {
    return [];
  }

  return [
    "Context budget:",
    `- ${report.instruction}`,
    `- History records: ${report.historyRecordCount}; stop-hook continuation turns: ${report.continuationTurnCount}.`,
    ...(report.reasons.length ? report.reasons.map((reason) => `- ${reason}`) : [])
  ];
}
