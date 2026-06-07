import { workerHandoff } from "./worker-handoff";
import type { ContextBudgetReport } from "./context-budget";
import type { DevnsConfig, Feature } from "./types";

export type OrchestratorHost = "generic" | "claude" | "codex";
export type OrchestratorMode = "bootstrap_required" | "continue_active" | "claim_next" | "blocked_ready" | "empty_queue";

function hostWorkerName(host: OrchestratorHost) {
  if (host === "claude") return "devns-feature-worker";
  if (host === "codex") return "devns_feature_worker";
  return "feature worker";
}

function hostReviewerName(host: OrchestratorHost) {
  if (host === "claude") return "devns-code-reviewer";
  if (host === "codex") return "devns_code_reviewer";
  return "review worker";
}

function hostLaunchInstruction(host: OrchestratorHost, agentName: string, job: string) {
  if (host === "claude") {
    return `Use the ${agentName} subagent for this ${job}.`;
  }

  if (host === "codex") {
    return `Explicitly spawn the ${agentName} subagent for this ${job}. Codex only spawns project custom agents when the parent asks for them.`;
  }

  return `Start a fresh isolated ${job} context with the prompt below.`;
}

function requiredLaneCommands(config: DevnsConfig) {
  return (config.reviewLanes ?? []).map((lane) => ({
    id: lane.id,
    type: lane.type,
    command: lane.command,
    agent: lane.agent,
    required: Boolean(lane.required),
    blocksCompletion: Boolean(lane.blocksCompletion)
  }));
}

function implementationPrompt(config: DevnsConfig, feature: Feature, cwd: string) {
  const handoff = workerHandoff(config, feature, cwd);
  return [
    "# DEVNS Feature Implementation Worker",
    "",
    `Feature: ${feature.id} - ${feature.title}`,
    `Expected outcome: ${handoff.expectedOutcome}`,
    "",
    "You own implementation for exactly one approved DEVNS feature.",
    "",
    "Rules:",
    "- Read AGENTS.md, .devns/index.md, the approved RFC, feature evidence, and latest history before editing.",
    "- Implement only this feature. Do not claim, release, complete, or commit the feature.",
    "- Keep unrelated files untouched.",
    "- If the implementation surface is unclear, inspect first and return a file plan before broad edits.",
    "- Run the validation commands relevant to the changed behavior.",
    "- Return a compact structured handoff to the main orchestrator.",
    "",
    "Worker handoff JSON:",
    JSON.stringify(handoff, null, 2),
    "",
    "Return shape:",
    JSON.stringify(
      {
        featureId: feature.id,
        status: "implemented | blocked",
        changedFiles: [],
        diffSummary: "",
        commandsRun: [{ command: "", status: "passed | failed", summary: "" }],
        evidenceToRecord: [],
        decisions: [],
        alternativesRejected: [],
        pitfalls: [],
        errors: [],
        fixes: [],
        lessons: [],
        blockers: [],
        suggestedCommitMessage: ""
      },
      null,
      2
    )
  ].join("\n");
}

function reviewPrompt(config: DevnsConfig, feature: Feature, host: OrchestratorHost) {
  return [
    "# DEVNS Read-Only Review Worker",
    "",
    `Review feature ${feature.id}: ${feature.title}.`,
    "",
    "Generate or read the DEVNS review packet, inspect RFC intent, Git diff, evidence, history, and project rules, then return exactly one lane-result JSON object for lane `code-review`.",
    "",
    "Suggested packet command:",
    `npm run devns -- review packet --feature ${feature.id} --format prompt --write --json`,
    "",
    "Ingest command for the main orchestrator, after saving the lane result to a temp JSON file:",
    `npm run devns -- lanes ingest --feature ${feature.id} --result <lane-result.json> --actor review-agent:${hostReviewerName(host)} --json`,
    "",
    "Review lanes configured in this project:",
    JSON.stringify(requiredLaneCommands(config), null, 2),
    "",
    "Decision rules:",
    "- block: evidence-backed high-confidence correctness, security, data loss, validation, or requirement failure.",
    "- needs_human_review: missing semantic evidence, ambiguous requirements, serious low-confidence risk, or possible intentional scope drift.",
    "- warn: nonblocking maintainability or low-risk test gap.",
    "- allow: no actionable issue; still list residual test gaps in recommendedActions."
  ].join("\n");
}

function contextBudgetNextStep(report?: ContextBudgetReport) {
  if (!report?.compactHandoffRecommended) return undefined;
  return report.resetRecommended
    ? "Context budget recommends a fresh worker or compact implementation context before more edits; read RFC/history/evidence from disk and use the bounded handoff."
    : "Launch the implementation subagent or fresh worker with the bounded handoff instead of continuing implementation in the main context.";
}

export function orchestrationPacket(input: {
  mode: OrchestratorMode;
  host: OrchestratorHost;
  cwd: string;
  config?: DevnsConfig;
  feature?: Feature;
  contextBudget?: ContextBudgetReport;
  claimed?: boolean;
  reasons?: string[];
  summary?: unknown;
}) {
  const workerName = hostWorkerName(input.host);
  const reviewerName = hostReviewerName(input.host);
  const featurePayload =
    input.feature && input.config
      ? {
          featureId: input.feature.id,
          title: input.feature.title,
          workerHandoff: workerHandoff(input.config, input.feature, input.cwd),
          implementationSubagent: {
            name: workerName,
            launchInstruction: hostLaunchInstruction(input.host, workerName, "feature implementation"),
            prompt: implementationPrompt(input.config, input.feature, input.cwd)
          },
          reviewSubagent: {
            name: reviewerName,
            launchInstruction: hostLaunchInstruction(input.host, reviewerName, "read-only code review"),
            prompt: reviewPrompt(input.config, input.feature, input.host)
          },
          contextBudget: input.contextBudget,
          mainAgentNextSteps: [
            contextBudgetNextStep(input.contextBudget),
            "Launch the implementation subagent with the implementation prompt.",
            "After the worker returns, run deterministic lanes with `npm run devns -- lanes run --feature <id> --write --json`.",
            "Launch the read-only review subagent with the review prompt or run the configured review lane.",
            "If review or lanes block, send a focused repair prompt back to the implementation subagent.",
            `When evidence, review, and commit gates are satisfied, run \`npm run devns -- complete --id ${input.feature.id} --json\` and create one feature commit.`
          ].filter((item): item is string => Boolean(item))
        }
      : undefined;

  return {
    mode: input.mode,
    host: input.host,
    claimed: input.claimed ?? false,
    stopHookRole: "safety_net_only",
    stopHookPolicy:
      "Stop hooks should block unsafe shutdown and surface active-feature blockers. The normal feature loop is owned by the main orchestrator plus per-feature subagents.",
    reasons: input.reasons ?? [],
    summary: input.summary,
    ...featurePayload
  };
}
