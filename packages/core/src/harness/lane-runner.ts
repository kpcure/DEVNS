import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Evidence, Feature, DevnsConfig } from "./types";
import { runBuiltinLane, type BuiltinLaneContext } from "./builtin-lanes";

const execAsync = promisify(exec);

export type LaneDefinition = NonNullable<DevnsConfig["reviewLanes"]>[number];

export type LaneFinding = {
  severity: "info" | "warning" | "error";
  message: string;
  category?: "correctness" | "security" | "scope" | "test" | "maintainability" | "reviewability";
  confidence?: "low" | "medium" | "high";
  file?: string;
  line?: number;
  requirementIds?: string[];
  evidence?: Array<{
    type: "diff" | "command" | "artifact" | "requirement" | "source";
    summary: string;
    url?: string;
  }>;
  suggestedFix?: string;
};

export type LaneResult = {
  lane: string;
  type: LaneDefinition["type"];
  status: "pass" | "fail" | "error" | "skipped" | "flaky_suspected";
  decision: "allow" | "warn" | "block" | "needs_human_review";
  summary: string;
  confidence: "low" | "medium" | "high";
  findings: LaneFinding[];
  evidence: Array<{
    type: string;
    summary: string;
  }>;
  artifacts: string[];
  recommendedActions: string[];
  blocksCompletion: boolean;
  required: boolean;
  durationMs?: number;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  stdoutDigest?: string;
  stderrDigest?: string;
  stdout?: string;
  stderr?: string;
};

export type LaneRunSummary = {
  results: LaneResult[];
  blocksCompletion: boolean;
  continuationReason?: string;
};

export class LaneRunnerError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function findingIsEvidenceBacked(finding: LaneFinding) {
  return (finding.evidence?.length ?? 0) > 0;
}

export function findingBlocksCompletion(finding: LaneFinding) {
  return finding.severity === "error" && finding.confidence === "high" && findingIsEvidenceBacked(finding);
}

export function decisionForFindings(findings: LaneFinding[], lane: LaneDefinition): LaneResult["decision"] {
  if (findings.some(findingBlocksCompletion) && (lane.blocksCompletion ?? true)) {
    return "block";
  }

  if (
    findings.some(
      (finding) =>
        finding.severity === "error" ||
        finding.confidence === "low" ||
        (finding.severity === "warning" && finding.confidence === "high")
    )
  ) {
    return "needs_human_review";
  }

  if (findings.some((finding) => finding.severity === "warning")) {
    return "warn";
  }

  return "allow";
}

function trimOutput(value: string) {
  const maxLength = 8000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... truncated ...` : value;
}

function digestOutput(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-8).join("\n");
}

function laneDecision(status: LaneResult["status"], lane: LaneDefinition, blocksCompletion: boolean): LaneResult["decision"] {
  if (blocksCompletion) return "block";
  if (status === "fail") return lane.required ? "needs_human_review" : "warn";
  if (status === "error") return lane.required ? "needs_human_review" : "warn";
  if (status === "skipped") return lane.required ? "needs_human_review" : "allow";
  if (status === "flaky_suspected") return "needs_human_review";
  return "allow";
}

function summarizeResult(result: LaneResult) {
  if (result.status === "pass") {
    return `Lane ${result.lane} passed.`;
  }

  if (result.status === "skipped") {
    return `Lane ${result.lane} was skipped: ${result.summary}`;
  }

  return `Lane ${result.lane} failed: ${result.summary}`;
}

export async function runCommandLane(lane: LaneDefinition, cwd: string): Promise<LaneResult> {
  if (!lane.command) {
    const blocksCompletion = lane.blocksCompletion ?? lane.required ?? false;
    return {
      lane: lane.id,
      type: "command",
      status: "error",
      decision: laneDecision("error", lane, blocksCompletion),
      summary: `Command lane ${lane.id} is missing command.`,
      confidence: "high",
      findings: [{ severity: "error", message: `Command lane ${lane.id} is missing command.` }],
      evidence: [],
      artifacts: [],
      recommendedActions: [`Add command to review lane ${lane.id} or change its type.`],
      blocksCompletion,
      required: lane.required ?? false
    };
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  try {
    const { stdout, stderr } = await execAsync(lane.command, {
      cwd,
      maxBuffer: 1024 * 1024 * 10
    });
    const durationMs = Date.now() - startedAt;
    const completedAt = new Date().toISOString();
    return {
      lane: lane.id,
      type: "command",
      status: "pass",
      decision: laneDecision("pass", lane, false),
      summary: `Command succeeded: ${lane.command}`,
      confidence: "high",
      findings: [],
      evidence: [
        {
          type: "command",
          summary: `${lane.command} exited with code 0 in ${durationMs}ms.`
        }
      ],
      artifacts: [],
      recommendedActions: [],
      blocksCompletion: false,
      required: lane.required ?? false,
      durationMs,
      exitCode: 0,
      startedAt: startedAtIso,
      completedAt,
      stdoutDigest: digestOutput(stdout),
      stderrDigest: digestOutput(stderr),
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr)
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const completedAt = new Date().toISOString();
    const execError = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    const blocksCompletion = lane.blocksCompletion ?? lane.required ?? false;
    const status = "fail";
    return {
      lane: lane.id,
      type: "command",
      status,
      decision: laneDecision(status, lane, blocksCompletion),
      summary: `Command failed: ${lane.command}`,
      confidence: "high",
      findings: [
        {
          severity: "error",
          message: execError.message
        }
      ],
      evidence: [
        {
          type: "command",
          summary: `${lane.command} exited with code ${execError.code ?? 1} in ${durationMs}ms.`
        }
      ],
      artifacts: [],
      recommendedActions: blocksCompletion
        ? [`Fix ${lane.id} command failure, rerun the lane, and update feature evidence.`]
        : [`Review ${lane.id} findings and decide whether legacy debt can be accepted for this feature.`],
      blocksCompletion,
      required: lane.required ?? false,
      durationMs,
      exitCode: execError.code ?? 1,
      startedAt: startedAtIso,
      completedAt,
      stdoutDigest: digestOutput(execError.stdout ?? ""),
      stderrDigest: digestOutput(execError.stderr ?? ""),
      stdout: trimOutput(execError.stdout ?? ""),
      stderr: trimOutput(execError.stderr ?? "")
    };
  }
}

export function skippedLane(lane: LaneDefinition): LaneResult {
  return {
    lane: lane.id,
    type: lane.type,
    status: "skipped",
    decision: laneDecision("skipped", lane, false),
    summary: `${lane.type} lanes are not executable in v0.1.`,
    confidence: "medium",
    findings: [
      {
        severity: "info",
        message: `${lane.type} lane schema is preserved, but execution is implemented in a later feature.`
      }
    ],
    evidence: [],
    artifacts: [],
    recommendedActions: [],
    blocksCompletion: false,
    required: lane.required ?? false
  };
}

export async function runLane(lane: LaneDefinition, cwd: string, context: Omit<BuiltinLaneContext, "cwd"> = {}): Promise<LaneResult> {
  if (lane.type === "command") {
    return runCommandLane(lane, cwd);
  }

  if (lane.type === "builtin") {
    return runBuiltinLane(lane, { ...context, cwd });
  }

  return skippedLane(lane);
}

export async function runReviewLanes(
  config: DevnsConfig,
  cwd = process.cwd(),
  context: Omit<BuiltinLaneContext, "cwd"> = {}
): Promise<LaneRunSummary> {
  const results: LaneResult[] = [];
  for (const lane of config.reviewLanes ?? []) {
    results.push(await runLane(lane, cwd, context));
  }

  const blockingResults = results.filter((result) => result.blocksCompletion);
  return {
    results,
    blocksCompletion: blockingResults.length > 0,
    continuationReason: blockingResults.length
      ? [
          "Review lanes blocked completion:",
          ...blockingResults.map((result) => `- ${summarizeResult(result)}`)
        ].join("\n")
      : undefined
  };
}

export function laneResultsToEvidence(results: LaneResult[]) {
  return results.map((result): Evidence => ({
    type: `lane:${result.lane}`,
    summary: `${summarizeResult(result)} Decision: ${result.decision}.`
  }));
}

export function laneInputForFeature(feature: Feature) {
  return {
    feature: {
      id: feature.id,
      title: feature.title,
      priority: feature.priority,
      risk: feature.risk,
      acceptanceCriteria: feature.acceptanceCriteria
    }
  };
}
