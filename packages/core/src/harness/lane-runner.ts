import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Feature, DevnsConfig } from "./types";
import { runBuiltinLane, type BuiltinLaneContext } from "./builtin-lanes";

const execAsync = promisify(exec);

export type LaneDefinition = NonNullable<DevnsConfig["reviewLanes"]>[number];

export type LaneFinding = {
  severity: "info" | "warning" | "error";
  message: string;
};

export type LaneResult = {
  lane: string;
  type: LaneDefinition["type"];
  status: "pass" | "fail" | "skipped";
  summary: string;
  confidence: "low" | "medium" | "high";
  findings: LaneFinding[];
  evidence: Array<{
    type: string;
    summary: string;
  }>;
  recommendedActions: string[];
  blocksCompletion: boolean;
  required: boolean;
  durationMs?: number;
  exitCode?: number;
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

function trimOutput(value: string) {
  const maxLength = 8000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... truncated ...` : value;
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
    throw new LaneRunnerError(`Command lane ${lane.id} is missing command.`);
  }

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(lane.command, {
      cwd,
      maxBuffer: 1024 * 1024 * 10
    });
    const durationMs = Date.now() - startedAt;
    return {
      lane: lane.id,
      type: "command",
      status: "pass",
      summary: `Command succeeded: ${lane.command}`,
      confidence: "high",
      findings: [],
      evidence: [
        {
          type: "command",
          summary: `${lane.command} exited with code 0 in ${durationMs}ms.`
        }
      ],
      recommendedActions: [],
      blocksCompletion: false,
      required: lane.required ?? false,
      durationMs,
      exitCode: 0,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr)
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const execError = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    const blocksCompletion = lane.blocksCompletion ?? lane.required ?? false;
    return {
      lane: lane.id,
      type: "command",
      status: "fail",
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
      recommendedActions: [`Fix ${lane.id} command failure, rerun the lane, and update feature evidence.`],
      blocksCompletion,
      required: lane.required ?? false,
      durationMs,
      exitCode: execError.code ?? 1,
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
    summary: `${lane.type} lanes are not executable in v0.1.`,
    confidence: "medium",
    findings: [
      {
        severity: "info",
        message: `${lane.type} lane schema is preserved, but execution is implemented in a later feature.`
      }
    ],
    evidence: [],
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
  return results.map((result) => ({
    type: `lane:${result.lane}`,
    summary: summarizeResult(result)
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
