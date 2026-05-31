import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Evidence, Feature, DevnsConfig } from "./types";
import { runBuiltinLane, type BuiltinLaneContext } from "./builtin-lanes";
import { writeReviewPacket, type ReviewPacket } from "./review-packet";
import { validateSchema } from "./schema-validator";
import laneResultSchema from "../../../../tools/schema/lane-result.schema.json";

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
  scores?: {
    correctness?: number;
    requirementCoverage?: number;
    scope?: number;
    security?: number;
    test?: number;
  };
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

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new LaneRunnerError("Agent lane did not return a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}

function normalizeAgentLaneResult(value: unknown, lane: LaneDefinition): LaneResult {
  const result = value as Partial<LaneResult>;
  return {
    lane: result.lane ?? lane.id,
    type: "agent",
    status: result.status ?? "error",
    decision: result.decision ?? "needs_human_review",
    summary: result.summary ?? "Agent lane returned no summary.",
    confidence: result.confidence ?? "low",
    findings: result.findings ?? [],
    scores: result.scores,
    evidence: result.evidence ?? [],
    artifacts: result.artifacts ?? [],
    recommendedActions: result.recommendedActions ?? [],
    blocksCompletion: result.blocksCompletion ?? result.decision === "block",
    required: result.required ?? lane.required ?? false,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    stdoutDigest: result.stdoutDigest,
    stderrDigest: result.stderrDigest,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function diffChangedFiles(packet?: ReviewPacket) {
  const diff = packet?.git.diff ?? "";
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match) {
      files.add(match[1]);
      files.add(match[2]);
    }
  }
  return files;
}

function findingGroundedInPacket(finding: LaneFinding, packet?: ReviewPacket) {
  if (!packet) return false;
  if (!finding.file || !finding.line) return false;
  const files = diffChangedFiles(packet);
  if (files.size === 0) return true;
  return files.has(finding.file);
}

function groundFindings(findings: LaneFinding[], packet?: ReviewPacket) {
  return findings.map((finding) => {
    if (!findingBlocksCompletion(finding) || findingGroundedInPacket(finding, packet)) {
      return finding;
    }

    return {
      ...finding,
      severity: "warning" as const,
      confidence: "low" as const,
      message: `Ungrounded review finding downgraded: ${finding.message}`,
      evidence: [
        ...(finding.evidence ?? []),
        {
          type: "artifact" as const,
          summary: "Finding was not grounded in the review packet diff with file and line evidence."
        }
      ]
    };
  });
}

function hasGroundedAllowEvidence(result: LaneResult) {
  return result.evidence.length > 0 || result.artifacts.length > 0;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function runAgentLane(
  lane: LaneDefinition,
  cwd: string,
  context: Omit<BuiltinLaneContext, "cwd"> = {}
): Promise<LaneResult> {
  if (!context.feature) {
    return {
      ...skippedLane(lane),
      summary: `Agent lane ${lane.id} skipped because no active or selected feature was provided.`,
      findings: [
        {
          severity: "info",
          message: "Run agent lanes with --feature <id> or while a feature is in_progress."
        }
      ]
    };
  }

  if (!lane.command) {
    return skippedLane(lane);
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let packetResult: Awaited<ReturnType<typeof writeReviewPacket>> | undefined;
  try {
    if (context.feature) {
      packetResult = await writeReviewPacket(cwd, {
        featureId: context.feature.id,
        format: "prompt",
        write: true,
        commit: context.feature.implementationCommit ?? context.feature.commit
      });
    }

    const { stdout, stderr } = await execAsync(lane.command, {
      cwd,
      maxBuffer: 1024 * 1024 * 10,
      env: {
        ...process.env,
        DEVNS_STOP_COMMAND: process.env.DEVNS_STOP_COMMAND ?? "true",
        DEVNS_FEATURE_ID: context.feature?.id ?? "",
        DEVNS_REVIEW_PACKET: packetResult?.jsonPath ?? "",
        DEVNS_REVIEW_PROMPT: packetResult?.promptPath ?? "",
        DEVNS_DIFF_BASE: context.feature?.implementationCommit ?? context.feature?.commit ?? "",
        DEVNS_REPO: cwd
      }
    });
    const parsed = JSON.parse(extractJsonObject(stdout)) as unknown;
    const schemaResult = validateSchema(parsed, laneResultSchema);
    if (!schemaResult.valid) {
      throw new LaneRunnerError(`Agent lane output failed lane-result schema validation: ${schemaResult.errors[0]}`);
    }
    const normalized = normalizeAgentLaneResult(parsed, lane);
    const groundedFindings = groundFindings(normalized.findings, packetResult?.packet);
    const harnessDecision = decisionForFindings(groundedFindings, lane);
    const decision =
      harnessDecision === "allow" && !groundedFindings.length && !hasGroundedAllowEvidence(normalized)
        ? "needs_human_review"
        : harnessDecision;
    const artifacts = uniqueValues([
      ...normalized.artifacts,
      packetResult?.jsonPath ?? "",
      packetResult?.promptPath ?? ""
    ]);
    return {
      ...normalized,
      lane: lane.id,
      type: "agent",
      decision,
      findings: groundedFindings,
      artifacts,
      blocksCompletion: decision === "block" || (decision === "needs_human_review" && (lane.blocksCompletion ?? lane.required ?? false)),
      durationMs: normalized.durationMs ?? Date.now() - startedAt,
      exitCode: normalized.exitCode ?? 0,
      startedAt: normalized.startedAt ?? startedAtIso,
      completedAt: normalized.completedAt ?? new Date().toISOString(),
      stdoutDigest: normalized.stdoutDigest ?? digestOutput(stdout),
      stderrDigest: normalized.stderrDigest ?? digestOutput(stderr),
      stdout: normalized.stdout ?? trimOutput(stdout),
      stderr: normalized.stderr ?? trimOutput(stderr)
    };
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string };
    const blocksCompletion = lane.blocksCompletion ?? lane.required ?? false;
    return {
      lane: lane.id,
      type: "agent",
      status: "error",
      decision: laneDecision("error", lane, blocksCompletion),
      summary: `Agent lane failed: ${execError.message}`,
      confidence: "high",
      findings: [{ severity: "error", message: execError.message, category: "reviewability", confidence: "high" }],
      evidence: [],
      artifacts: [],
      recommendedActions: [`Fix agent lane ${lane.id}, rerun it, and ingest a valid lane result.`],
      blocksCompletion,
      required: lane.required ?? false,
      durationMs: Date.now() - startedAt,
      exitCode: execError.code ?? 1,
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
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

  if (lane.type === "agent") {
    return runAgentLane(lane, cwd, context);
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
    summary: `${summarizeResult(result)} Decision: ${result.decision}.`,
    actor: result.type === "agent" ? `review-agent:${result.lane}` : `lane:${result.lane}`,
    producedAt: result.completedAt ?? new Date().toISOString(),
    artifactRefs: result.artifacts,
    verificationType: result.type === "agent" ? "review_agent" : result.type === "command" ? "command" : "static_review"
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
