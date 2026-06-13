import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initDevns } from "../packages/core/src/cli/init";
import { evaluateClaudeStopHook } from "../packages/core/src/harness/claude-stop";
import { evaluateCompletionGate } from "../packages/core/src/harness/completion-gate";
import { evaluateEvidenceQuality } from "../packages/core/src/harness/evidence-quality";
import { evaluateArtifactIntegrity } from "../packages/core/src/harness/artifact-integrity";
import { buildArtifactDigests, type ArtifactDigest } from "../packages/core/src/harness/artifact-digest";
import { evaluateContextBudgetFromCounts } from "../packages/core/src/harness/context-budget";
import { loadConfig } from "../packages/core/src/harness/config";
import {
  auditDashboardArtifactPreview,
  auditDashboardArtifactPreviewArtifacts
} from "../packages/core/src/harness/dashboard-artifact-preview";
import { runScopeGuard } from "../packages/core/src/harness/builtin-lanes";
import { findingBlocksCompletion, type LaneFinding, type LaneResult } from "../packages/core/src/harness/lane-runner";
import { auditOrchestratorTraces, type OrchestratorTraceRecord } from "../packages/core/src/harness/orchestrator-trace";
import { readJsonFile, writeJsonFile } from "../packages/core/src/harness/state";
import type { CandidateFeature, DevnsConfig, Feature, FeatureInventory, ReviewDecision } from "../packages/core/src/harness/types";
import { validateSchema } from "../packages/core/src/harness/schema-validator";
import evalCaseSchema from "../tools/schema/eval-case.schema.json";
import laneResultSchema from "../tools/schema/lane-result.schema.json";
import { passK } from "./metrics";

const execFileAsync = promisify(execFile);

export type EvalDecision = "allowed" | "blocked";
export type EvalTier = "t1" | "t2" | "t3";

export type EvalCase = {
  id: string;
  tier: EvalTier;
  mode: string;
  generality_level: "distribution" | "task" | "domain" | "general";
  given: Record<string, unknown>;
  action: {
    gate:
      | "completion_independent_review"
      | "candidate_provenance"
      | "scope_guard"
      | "evidence_quality"
      | "artifact_integrity"
      | "artifact_digest"
      | "dashboard_artifact_preview"
      | "review_lane_result"
      | "review_calibration_result"
      | "review_adapter_execution"
      | "review_packet_quality"
      | "context_budget"
      | "project_extension_config"
      | "host_adapter_init"
      | "stop_hook_review_agent"
      | "seed_repository"
      | "orchestrator_trace"
      | "state_atomic_write";
    cmd?: string;
    args?: Record<string, unknown>;
  };
  expect: {
    decision: EvalDecision;
    reasonContains?: string;
    laneDecision?: LaneResult["decision"];
    requiredFindings?: FindingExpectation[];
    forbiddenFindings?: FindingExpectation[];
    minScores?: NonNullable<LaneResult["scores"]>;
    maxErrorFindings?: number;
  };
};

export type EvalCaseOutcome = {
  id: string;
  tier: EvalTier;
  mode: string;
  expected: EvalDecision;
  actual: EvalDecision;
  reason: string;
  pass: boolean;
  metadata?: Record<string, unknown>;
};

type FindingExpectation = {
  severity?: LaneFinding["severity"];
  category?: LaneFinding["category"];
  confidence?: LaneFinding["confidence"];
  file?: string;
  line?: number;
  messageContains?: string;
  requirementIds?: string[];
  evidenceTypes?: string[];
  blocksCompletion?: boolean;
};

type EvalArtifact = {
  path: string;
  content: string | Record<string, unknown>;
  encoding?: "base64";
};

type SeedCommand = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  expectedExitCode?: number;
  timeoutMs?: number;
  failureClass?: string;
};

type SeedExpectedArtifact = {
  path: string;
  contains?: string | string[];
  failureClass?: string;
};

type ReviewAdapterCommand = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
};

type HostAdapterInitMutation = {
  type: "remove" | "chmod" | "write";
  path: string;
  mode?: number;
  content?: string | Record<string, unknown>;
};

type StopHookReviewScenario = "review_agent_allows" | "review_agent_blocks" | "recursion_guard";

function asDecision(blocked: boolean): EvalDecision {
  return blocked ? "blocked" : "allowed";
}

function containsProjectExternalDomainTerm(candidate: CandidateFeature, projectText: string) {
  const text = `${candidate.id} ${candidate.title} ${candidate.description}`.toLowerCase();
  const project = projectText.toLowerCase();
  const sentinelTerms = ["library", "borrow", "patron", "book checkout", "图书馆", "借阅", "馆藏", "读者"];
  return sentinelTerms.some((term) => text.includes(term.toLowerCase()) && !project.includes(term.toLowerCase()));
}

function evaluateCandidateProvenance(given: Record<string, unknown>) {
  const candidates = (given.candidates ?? []) as CandidateFeature[];
  const projectText = String(given.projectText ?? "");
  const missing = candidates.filter((candidate) => !(candidate.sources?.length ?? 0));
  const drifted = candidates.filter((candidate) => containsProjectExternalDomainTerm(candidate, projectText));

  if (missing.length || drifted.length) {
    return {
      decision: "blocked" as const,
      reason: [
        missing.length ? `${missing.length} candidate(s) missing provenance sources.` : "",
        drifted.length ? `${drifted.length} candidate(s) contain project-external domain terms.` : ""
      ]
        .filter(Boolean)
        .join(" ")
    };
  }

  return { decision: "allowed" as const, reason: "Candidate provenance gate passed." };
}

async function evaluateScopeGuard(given: Record<string, unknown>) {
  const result = await runScopeGuard(
    { id: "scope-guard", type: "builtin", required: true, blocksCompletion: true },
    {
      cwd: process.cwd(),
      feature: given.feature as Feature,
      changedFiles: (given.changedFiles ?? []) as string[]
    }
  );
  return {
    decision: asDecision(result.decision === "block"),
    reason: result.summary
  };
}

function evaluateEvidenceQualityGate(given: Record<string, unknown>) {
  const report = evaluateEvidenceQuality(given.feature as Feature);
  return {
    decision: ["block", "needs_human_review"].includes(report.decision) ? ("blocked" as const) : ("allowed" as const),
    reason: report.summary
  };
}

function includesAll(actual: string[] | undefined, expected: string[] | undefined) {
  return (expected ?? []).every((item) => (actual ?? []).includes(item));
}

function findingMatches(finding: LaneFinding, expected: FindingExpectation) {
  if (expected.severity && finding.severity !== expected.severity) return false;
  if (expected.category && finding.category !== expected.category) return false;
  if (expected.confidence && finding.confidence !== expected.confidence) return false;
  if (expected.file && finding.file !== expected.file) return false;
  if (expected.line && finding.line !== expected.line) return false;
  if (expected.messageContains && !finding.message.includes(expected.messageContains)) return false;
  if (!includesAll(finding.requirementIds, expected.requirementIds)) return false;
  const evidenceTypes = finding.evidence?.map((item) => item.type) ?? [];
  if (!includesAll(evidenceTypes, expected.evidenceTypes)) return false;
  if (expected.blocksCompletion !== undefined && findingBlocksCompletion(finding) !== expected.blocksCompletion) return false;
  return true;
}

function evaluateReviewLaneResult(given: Record<string, unknown>, expect: EvalCase["expect"]) {
  const validation = validateSchema(given.laneResult, laneResultSchema);
  if (!validation.valid) {
    return {
      decision: "blocked" as const,
      reason: `Review lane result failed schema validation: ${validation.errors.join(" ")}`
    };
  }

  const result = given.laneResult as LaneResult;
  const issues: string[] = [];

  if (expect.laneDecision && result.decision !== expect.laneDecision) {
    issues.push(`Expected lane decision ${expect.laneDecision}, got ${result.decision}.`);
  }

  if (result.decision === "block" && !result.blocksCompletion) {
    issues.push("Blocking review lane result must set blocksCompletion=true.");
  }

  if ((result.decision === "allow" || result.decision === "warn") && result.blocksCompletion) {
    issues.push("Allowing or warning review lane result must not block completion.");
  }

  if (result.decision === "allow" && result.evidence.length === 0 && result.artifacts.length === 0) {
    issues.push("Allow review result must include review evidence or artifacts.");
  }

  if (result.decision === "allow" && result.recommendedActions.length === 0) {
    issues.push("Allow review result must list residual test gaps or explicitly state no follow-up action.");
  }

  const blockingFindings = result.findings.filter(findingBlocksCompletion);
  if (result.blocksCompletion && blockingFindings.length === 0) {
    issues.push("Blocking review result lacks a high-confidence evidence-backed error finding.");
  }

  for (const finding of blockingFindings) {
    if (!finding.file || !finding.line || !(finding.evidence?.length ?? 0)) {
      issues.push("Blocking finding lacks file, line, or evidence grounding.");
    }
  }

  for (const [scoreName, minimum] of Object.entries(expect.minScores ?? {})) {
    const actual = result.scores?.[scoreName as keyof NonNullable<LaneResult["scores"]>];
    if (actual === undefined || actual < minimum) {
      issues.push(`Score ${scoreName} expected >= ${minimum}, got ${actual ?? "missing"}.`);
    }
  }

  if (expect.maxErrorFindings !== undefined) {
    const errorCount = result.findings.filter((finding) => finding.severity === "error").length;
    if (errorCount > expect.maxErrorFindings) {
      issues.push(`Expected at most ${expect.maxErrorFindings} error finding(s), got ${errorCount}.`);
    }
  }

  for (const expected of expect.requiredFindings ?? []) {
    if (!result.findings.some((finding) => findingMatches(finding, expected))) {
      issues.push(`Missing required review finding: ${JSON.stringify(expected)}.`);
    }
  }

  for (const forbidden of expect.forbiddenFindings ?? []) {
    if (result.findings.some((finding) => findingMatches(finding, forbidden))) {
      issues.push(`Forbidden review finding was present: ${JSON.stringify(forbidden)}.`);
    }
  }

  return {
    decision: issues.length ? ("blocked" as const) : ("allowed" as const),
    reason: issues.length ? issues.join(" ") : "Review lane result golden gate passed."
  };
}

function packetDiffIncludesFile(packet: Record<string, unknown>, file: string) {
  const diff = stringValue(recordValue(packet.git)?.diff);
  return (
    diff.includes(` b/${file}`) ||
    diff.includes(` a/${file}`) ||
    diff.includes(`+++ b/${file}`) ||
    diff.includes(`--- a/${file}`)
  );
}

function packetChangedFiles(packet: Record<string, unknown>) {
  return arrayValue(recordValue(packet.feature)?.changedFiles).map(stringValue).filter(Boolean);
}

function packetRequirementIds(packet: Record<string, unknown>) {
  const rfc = recordValue(packet.rfc);
  const requirements = arrayValue(rfc?.requirements).map(recordValue).filter(Boolean);
  const acceptanceCriteria = arrayValue(rfc?.acceptanceCriteria).map(recordValue).filter(Boolean);
  return new Set([
    ...requirements.map((requirement) => stringValue(requirement?.id)).filter(Boolean),
    ...acceptanceCriteria.flatMap((criterion) => arrayValue(criterion?.requirementIds).map(stringValue).filter(Boolean))
  ]);
}

function findingGroundedInPacket(finding: LaneFinding, packet: Record<string, unknown>) {
  const issues: string[] = [];
  if (finding.file) {
    const changedFiles = packetChangedFiles(packet);
    if (!changedFiles.includes(finding.file) && !packetDiffIncludesFile(packet, finding.file)) {
      issues.push(`Finding file ${finding.file} is not present in packet changedFiles or diff.`);
    }
  }

  const packetRequirements = packetRequirementIds(packet);
  for (const requirementId of finding.requirementIds ?? []) {
    if (!packetRequirements.has(requirementId)) {
      issues.push(`Finding requirement ${requirementId} is not present in packet RFC context.`);
    }
  }

  const evidenceTypes = new Set((finding.evidence ?? []).map((item) => item.type));
  if (evidenceTypes.has("diff") && finding.file && !packetDiffIncludesFile(packet, finding.file)) {
    issues.push(`Diff evidence for ${finding.file} is not grounded in packet diff.`);
  }
  if (evidenceTypes.has("requirement") && !(finding.requirementIds ?? []).some((id) => packetRequirements.has(id))) {
    issues.push("Requirement evidence does not cite a requirement present in the packet.");
  }

  return issues;
}

function oracleFindingExpectations(given: Record<string, unknown>) {
  const oracle = recordValue(given.oracle);
  return arrayValue(oracle?.findings ?? given.oracleFindings)
    .map(recordValue)
    .filter(Boolean)
    .map((finding) => ({
      id: stringValue(finding?.id),
      expectation: finding as FindingExpectation
    }));
}

function evaluateReviewCalibrationResult(given: Record<string, unknown>, expect: EvalCase["expect"]) {
  const packet = recordValue(given.reviewPacket ?? given.packet);
  if (!packet) {
    return {
      decision: "blocked" as const,
      reason: "Review calibration failed: missing review packet object."
    };
  }

  const issues: string[] = [];
  const packetGate = evaluateReviewPacketQuality({ reviewPacket: packet });
  if (packetGate.decision === "blocked") {
    issues.push(packetGate.reason);
  }

  const laneGate = evaluateReviewLaneResult(given, expect);
  if (laneGate.decision === "blocked") {
    issues.push(laneGate.reason);
  }

  const laneResult = recordValue(given.laneResult);
  const result = laneResult as LaneResult | undefined;
  const oracleFindings = oracleFindingExpectations(given);
  if (!oracleFindings.length) {
    issues.push("Review calibration failed: missing oracle findings.");
  }

  for (const { id, expectation } of oracleFindings) {
    const finding = result?.findings?.find((candidate) => findingMatches(candidate, expectation));
    if (!finding) {
      issues.push(`Missing oracle review finding${id ? ` ${id}` : ""}: ${JSON.stringify(expectation)}.`);
      continue;
    }

    const groundingIssues = findingGroundedInPacket(finding, packet);
    if (groundingIssues.length) {
      issues.push(`Oracle finding${id ? ` ${id}` : ""} is not grounded in packet: ${groundingIssues.join(" ")}`);
    }
  }

  return {
    decision: issues.length ? ("blocked" as const) : ("allowed" as const),
    reason: issues.length ? issues.join(" ") : "Review calibration golden gate passed."
  };
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Review adapter did not return a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}

function substituteAdapterValue(
  value: string,
  input: { repoRoot: string; workdir: string; packetPath: string; promptPath: string }
) {
  return value
    .replaceAll("${repoRoot}", input.repoRoot)
    .replaceAll("${workdir}", input.workdir)
    .replaceAll("${packetPath}", input.packetPath)
    .replaceAll("${promptPath}", input.promptPath)
    .replaceAll("${node}", process.execPath);
}

async function evaluateReviewAdapterExecution(given: Record<string, unknown>, expect: EvalCase["expect"], repoRoot = process.cwd()) {
  const packet = recordValue(given.reviewPacket ?? given.packet);
  if (!packet) {
    return {
      decision: "blocked" as const,
      reason: "Review adapter execution failed: missing review packet object."
    };
  }

  const adapter = recordValue(given.adapter ?? given.reviewAdapter);
  const command = adapter as ReviewAdapterCommand | undefined;
  const commandText = stringValue(command?.command);
  if (!adapter || !command || !commandText) {
    return {
      decision: "blocked" as const,
      reason: "Review adapter execution failed: missing adapter command."
    };
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-review-adapter-"));
  try {
    await writeEvalArtifacts(cwd, (adapter.files ?? given.files ?? []) as EvalArtifact[]);
    const packetPath = path.join(cwd, "review-packet.json");
    const promptPath = path.join(cwd, "review-prompt.md");
    const prompt =
      stringValue(given.reviewPrompt) ||
      [
        "# DEVNS Review Adapter Eval",
        "",
        ...arrayValue(packet.reviewInstructions).map(stringValue).filter(Boolean),
        "",
        "Return exactly one lane-result JSON object."
      ].join("\n");
    await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
    await writeFile(promptPath, `${prompt}\n`);

    const replacementInput = { repoRoot, workdir: cwd, packetPath, promptPath };
    const executable = substituteAdapterValue(commandText, replacementInput);
    const args = (command.args ?? []).map((arg) => substituteAdapterValue(arg, replacementInput));
    const env = Object.fromEntries(
      Object.entries(command.env ?? {}).map(([key, value]) => [key, substituteAdapterValue(value, replacementInput)])
    );

    const feature = recordValue(packet.feature);
    const git = recordValue(packet.git);
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(executable, args, {
        cwd,
        env: {
          ...process.env,
          DEVNS_STOP_COMMAND: "true",
          DEVNS_FEATURE_ID: stringValue(feature?.id),
          DEVNS_REVIEW_PACKET: packetPath,
          DEVNS_REVIEW_PROMPT: promptPath,
          DEVNS_DIFF_BASE: stringValue(git?.base),
          DEVNS_REPO: cwd,
          ...env
        },
        timeout: command.timeoutMs ?? 30_000,
        maxBuffer: 2 * 1024 * 1024
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const execError = error as Error & { code?: number; stdout?: string; stderr?: string };
      return {
        decision: "blocked" as const,
        reason: [
          `Review adapter execution failed: command exited with ${execError.code ?? 1}: ${execError.message}`,
          stringValue(execError.stdout) ? `stdout: ${stringValue(execError.stdout)}` : "",
          stringValue(execError.stderr) ? `stderr: ${stringValue(execError.stderr)}` : ""
        ]
          .filter(Boolean)
          .join(" ")
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(stdout));
    } catch (error) {
      return {
        decision: "blocked" as const,
        reason: `Review adapter execution failed: ${error instanceof Error ? error.message : "invalid JSON output"}. stderr: ${stderr}`
      };
    }

    const validation = validateSchema(parsed, laneResultSchema);
    if (!validation.valid) {
      return {
        decision: "blocked" as const,
        reason: `Review adapter execution failed lane-result schema validation: ${validation.errors.join(" ")}`
      };
    }

    const calibration = evaluateReviewCalibrationResult({ ...given, reviewPacket: packet, laneResult: parsed }, expect);
    return {
      decision: calibration.decision,
      reason:
        calibration.decision === "allowed"
          ? `Review adapter execution golden gate passed. ${calibration.reason}`
          : calibration.reason
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function packetHasReviewOutputContract(packet: Record<string, unknown>) {
  const instructions = arrayValue(packet.reviewInstructions).map((item) => stringValue(item).toLowerCase());
  const rendered = stringValue(packet.renderedPrompt ?? packet.prompt).toLowerCase();
  return (
    instructions.some((item) => item.includes("read-only") || item.includes("read only")) &&
    (instructions.some((item) => item.includes("lane-result") || item.includes("findings")) ||
      rendered.includes("lane-result json object"))
  );
}

function evaluateReviewPacketQuality(given: Record<string, unknown>) {
  const packet = recordValue(given.reviewPacket ?? given.packet);
  if (!packet) {
    return {
      decision: "blocked" as const,
      reason: "Review packet quality failed: missing review packet object."
    };
  }

  const issues: string[] = [];
  const feature = recordValue(packet.feature);
  const rfc = recordValue(packet.rfc);
  const git = recordValue(packet.git);
  const evidenceQuality = recordValue(packet.evidenceQuality);
  const evidence = arrayValue(packet.evidence);
  const artifactRefs = arrayValue(packet.artifactRefs);
  const artifactDigests = arrayValue(packet.artifactDigests).map(recordValue).filter(Boolean);
  const history = arrayValue(packet.history).map(recordValue).filter(Boolean);
  const projectRules = arrayValue(packet.projectRules).map(recordValue).filter(Boolean);

  if (packet.schemaVersion !== 1) issues.push("missing schemaVersion=1");
  if (!stringValue(feature?.id) || !stringValue(feature?.title)) issues.push("missing feature identity");
  if (!arrayValue(feature?.acceptanceCriteria).length) issues.push("missing feature acceptance criteria");
  if (rfc?.status !== "approved") issues.push("missing approved RFC");
  if (!arrayValue(rfc?.requirements).length) issues.push("missing RFC requirements");
  if (!arrayValue(rfc?.acceptanceCriteria).length) issues.push("missing RFC acceptance criteria");
  const validationPlan = recordValue(rfc?.validationPlan);
  if (!arrayValue(validationPlan?.dynamic).length && !arrayValue(validationPlan?.static).length) {
    issues.push("missing RFC validation plan");
  }
  if (!stringValue(git?.diff).trim()) issues.push("missing Git diff");
  if (git?.truncated === true && !stringValue(git?.diff).includes("truncated by DEVNS review packet budget")) {
    issues.push("truncated diff lacks explicit truncation marker");
  }
  if (!stringValue(evidenceQuality?.summary) || !stringValue(evidenceQuality?.decision)) {
    issues.push("missing evidence quality report");
  }
  if (!evidence.length && !artifactRefs.length && !artifactDigests.length) {
    issues.push("missing evidence or artifacts");
  }
  if (artifactRefs.length && !artifactDigests.length) {
    issues.push("artifact refs lack review-facing digests");
  }
  if (
    artifactDigests.some(
      (digest) =>
        !stringValue(digest?.artifactRef) ||
        !stringValue(digest?.summary) ||
        ["missing", "invalid"].includes(stringValue(digest?.status))
    )
  ) {
    issues.push("artifact digest is missing, invalid, or not review-facing");
  }
  if (!history.length) issues.push("missing execution history");
  if (history.length && !history.some((record) => arrayValue(record?.decisions).length || arrayValue(record?.lessons).length)) {
    issues.push("history lacks decisions or lessons");
  }
  if (!projectRules.length) issues.push("missing project rules");
  if (projectRules.length && !projectRules.some((rule) => stringValue(rule?.path).endsWith("AGENTS.md") || stringValue(rule?.content))) {
    issues.push("project rules lack readable content");
  }
  if (!packetHasReviewOutputContract(packet)) {
    issues.push("missing read-only lane-result output contract");
  }

  return {
    decision: issues.length ? ("blocked" as const) : ("allowed" as const),
    reason: issues.length ? `Review packet quality failed: ${issues.join("; ")}.` : "Review packet quality golden gate passed."
  };
}

function evaluateOrchestratorTrace(given: Record<string, unknown>) {
  const records = ((given.records ?? (given.record ? [given.record] : [])) as OrchestratorTraceRecord[]);
  const audit = auditOrchestratorTraces(records);
  return {
    decision: audit.decision === "pass" ? ("allowed" as const) : ("blocked" as const),
    reason: audit.findings.length ? audit.findings.map((finding) => finding.message).join(" ") : "Orchestrator trace audit passed."
  };
}

function evaluateContextBudgetGate(given: Record<string, unknown>) {
  const report = evaluateContextBudgetFromCounts(given.config as DevnsConfig, given.feature as Feature, {
    historyRecordCount: typeof given.historyRecordCount === "number" ? given.historyRecordCount : undefined,
    continuationTurnCount: typeof given.continuationTurnCount === "number" ? given.continuationTurnCount : undefined
  });
  return {
    decision: report.resetRecommended ? ("blocked" as const) : ("allowed" as const),
    reason: report.resetRecommended ? report.reasons.join(" ") : report.instruction
  };
}

function valueLabel(value: unknown) {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
}

function expectedConfigMismatches(actual: unknown, expected: unknown, pathLabel = "config"): string[] {
  if (isExpectedObject(expected)) {
    if (!isExpectedObject(actual)) {
      return [`${pathLabel} expected object, got ${valueLabel(actual)}.`];
    }
    return Object.entries(expected).flatMap(([key, value]) => expectedConfigMismatches(actual[key], value, `${pathLabel}.${key}`));
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [`${pathLabel} expected array, got ${valueLabel(actual)}.`];
    }
    const missing = expected.filter(
      (expectedItem) => !actual.some((actualItem) => expectedConfigMismatches(actualItem, expectedItem, pathLabel).length === 0)
    );
    return missing.map((item) => `${pathLabel} missing expected array item ${valueLabel(item)}.`);
  }

  return Object.is(actual, expected) ? [] : [`${pathLabel} expected ${valueLabel(expected)}, got ${valueLabel(actual)}.`];
}

function isExpectedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function evaluateProjectExtensionConfig(given: Record<string, unknown>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-extensions-"));
  try {
    await writeEvalArtifacts(cwd, (given.artifacts ?? []) as EvalArtifact[]);
    const resolved = await loadConfig(cwd);
    const expectedConfig = isExpectedObject(given.expectedConfig) ? given.expectedConfig : {};
    const mismatches = expectedConfigMismatches(resolved.config, expectedConfig);
    return {
      decision: mismatches.length ? ("blocked" as const) : ("allowed" as const),
      reason: mismatches.length ? `Project extension config failed: ${mismatches.join(" ")}` : "Project extension config gate passed."
    };
  } catch (error) {
    return {
      decision: "blocked" as const,
      reason: `Project extension config failed: ${error instanceof Error ? error.message : "unknown error"}`
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function withMutedStdout<T>(fn: () => Promise<T>) {
  const originalWrite = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function applyHostAdapterInitMutation(cwd: string, mutation: HostAdapterInitMutation) {
  const target = path.join(cwd, mutation.path);
  if (mutation.type === "remove") {
    await rm(target, { recursive: true, force: true });
    return;
  }

  if (mutation.type === "chmod") {
    await chmod(target, mutation.mode ?? 0o644);
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    typeof mutation.content === "string" ? mutation.content : `${JSON.stringify(mutation.content ?? {}, null, 2)}\n`
  );
}

async function readRequiredText(cwd: string, relativePath: string, issues: string[]) {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    issues.push(`Missing required host adapter file: ${relativePath}.`);
    return "";
  }
}

async function readRequiredJson(cwd: string, relativePath: string, issues: string[]) {
  const raw = await readRequiredText(cwd, relativePath, issues);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    issues.push(`Host adapter file is not valid JSON: ${relativePath}.`);
    return undefined;
  }
}

async function requireExecutable(cwd: string, relativePath: string, label: string, issues: string[]) {
  try {
    const result = await stat(path.join(cwd, relativePath));
    if (!result.isFile()) {
      issues.push(`${label} is not a file: ${relativePath}.`);
      return;
    }
    if (!Boolean(result.mode & 0o111)) {
      issues.push(`${label} is not executable: ${relativePath}.`);
    }
  } catch {
    issues.push(`Missing ${label}: ${relativePath}.`);
  }
}

function expectTextContains(text: string, expected: string, label: string, issues: string[]) {
  if (!text.includes(expected)) {
    issues.push(`${label} must contain ${JSON.stringify(expected)}.`);
  }
}

function nestedRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function nestedArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function firstStopHook(settings: Record<string, unknown> | undefined) {
  const hooks = nestedRecord(settings?.hooks);
  const stop = nestedArray(hooks?.Stop);
  const group = nestedRecord(stop[0]);
  return nestedRecord(nestedArray(group?.hooks)[0]);
}

async function auditCodexHostAdapter(cwd: string, issues: string[]) {
  const hooks = await readRequiredJson(cwd, ".codex/hooks.json", issues);
  const stopHook = firstStopHook(hooks);
  if (stopHook?.type !== "command") {
    issues.push("Codex Stop hook must use type=command.");
  }
  const command = stringValue(stopHook?.command);
  expectTextContains(command, "DEVNS_PROJECT_DIR=", "Codex Stop hook command", issues);
  expectTextContains(command, "plugins/codex/devns/scripts/devns-stop-hook.sh", "Codex Stop hook command", issues);

  await requireExecutable(cwd, "plugins/codex/devns/scripts/devns-stop-hook.sh", "Codex stop hook script", issues);
  await requireExecutable(cwd, ".devns/adapters/code-review.codex.sh", "Codex code-review adapter", issues);

  const lane = await readRequiredJson(cwd, ".devns/lanes/code-review.json", issues);
  if (lane?.type !== "agent") {
    issues.push("Codex code-review lane must be type=agent.");
  }
  if (lane?.command !== "bash .devns/adapters/code-review.codex.sh") {
    issues.push("Codex code-review lane command must call .devns/adapters/code-review.codex.sh.");
  }
  if (lane?.blocksCompletion !== true) {
    issues.push("Codex code-review lane must block completion.");
  }

  const worker = await readRequiredText(cwd, ".codex/agents/devns_feature_worker.toml", issues);
  expectTextContains(worker, 'name = "devns_feature_worker"', "Codex feature worker agent", issues);
  expectTextContains(worker, "implement exactly one feature", "Codex feature worker agent", issues);
  expectTextContains(worker, "Do not claim", "Codex feature worker agent", issues);

  const reviewer = await readRequiredText(cwd, ".codex/agents/devns_code_reviewer.toml", issues);
  expectTextContains(reviewer, 'name = "devns_code_reviewer"', "Codex code reviewer agent", issues);
  expectTextContains(reviewer, "lane-result JSON", "Codex code reviewer agent", issues);
  expectTextContains(reviewer, "Do not edit", "Codex code reviewer agent", issues);
}

async function auditClaudeHostAdapter(cwd: string, issues: string[]) {
  const settings = await readRequiredJson(cwd, ".claude/settings.json", issues);
  const stopHook = firstStopHook(settings);
  if (stopHook?.type !== "agent") {
    issues.push("Claude Stop hook must use type=agent.");
  }
  const prompt = stringValue(stopHook?.prompt);
  expectTextContains(prompt, "DEVNS Stop Review Agent", "Claude Stop hook prompt", issues);
  expectTextContains(prompt, "DEVNS_STOP_AGENT_HOOK=claude", "Claude Stop hook prompt", issues);

  const hookPrompt = await readRequiredText(cwd, "plugins/claude-code/devns/prompts/stop-review-agent-hook.md", issues);
  expectTextContains(hookPrompt, "Return exactly one JSON object", "Claude Stop Review Agent prompt", issues);
  expectTextContains(hookPrompt, "lanes ingest", "Claude Stop Review Agent prompt", issues);

  await requireExecutable(cwd, ".devns/adapters/code-review.claude.sh", "Claude code-review adapter", issues);

  const lane = await readRequiredJson(cwd, ".devns/lanes/code-review.json", issues);
  if (lane?.type !== "agent") {
    issues.push("Claude code-review lane must be type=agent.");
  }
  if (lane?.command !== "bash .devns/adapters/code-review.claude.sh") {
    issues.push("Claude code-review lane command must call .devns/adapters/code-review.claude.sh.");
  }
  if (lane?.blocksCompletion !== true) {
    issues.push("Claude code-review lane must block completion.");
  }

  const worker = await readRequiredText(cwd, ".claude/agents/feature-worker.md", issues);
  expectTextContains(worker, "name: devns-feature-worker", "Claude feature worker agent", issues);
  expectTextContains(worker, "implement exactly one feature", "Claude feature worker agent", issues);
  expectTextContains(worker, "Do not claim", "Claude feature worker agent", issues);

  const reviewer = await readRequiredText(cwd, ".claude/agents/code-reviewer.md", issues);
  expectTextContains(reviewer, "name: devns-code-reviewer", "Claude code reviewer agent", issues);
  expectTextContains(reviewer, "read-only reviewer", "Claude code reviewer agent", issues);
  expectTextContains(reviewer, "Do not edit", "Claude code reviewer agent", issues);
}

async function evaluateHostAdapterInit(given: Record<string, unknown>) {
  const host = stringValue(given.host);
  if (!["codex", "claude", "both"].includes(host)) {
    return {
      decision: "blocked" as const,
      reason: "Host adapter init gate failed: host must be codex, claude, or both."
    };
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-host-init-"));
  const originalCwd = process.cwd();
  try {
    await writeFile(
      path.join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "devns-host-init-eval",
          version: "0.0.0",
          scripts: {
            test: "echo \"Error: no test specified\" && exit 1",
            build: "echo build"
          }
        },
        null,
        2
      )}\n`
    );
    process.chdir(cwd);
    await withMutedStdout(() =>
      initDevns({
        force: false,
        projectName: "Host Adapter Init Eval",
        projectDescription: "Evaluate DEVNS host adapter initialization.",
        host: host as "codex" | "claude" | "both"
      })
    );
    process.chdir(originalCwd);

    for (const mutation of (given.mutations ?? []) as HostAdapterInitMutation[]) {
      await applyHostAdapterInitMutation(cwd, mutation);
    }

    const issues: string[] = [];
    if (host === "codex" || host === "both") {
      await auditCodexHostAdapter(cwd, issues);
    }
    if (host === "claude" || host === "both") {
      await auditClaudeHostAdapter(cwd, issues);
    }

    return {
      decision: issues.length ? ("blocked" as const) : ("allowed" as const),
      reason: issues.length ? `Host adapter init failed: ${issues.join(" ")}` : "Host adapter init gate passed."
    };
  } catch (error) {
    return {
      decision: "blocked" as const,
      reason: `Host adapter init failed: ${error instanceof Error ? error.message : "unknown error"}`
    };
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

function evalApprovedRfc(summary = "Eval RFC"): Feature["rfc"] {
  return {
    status: "approved",
    summary,
    background: "Eval background",
    featureDescription: "Eval feature",
    expectedOutcome: "Eval outcome",
    goals: ["Verify DEVNS stop hook orchestration"],
    nonGoals: ["Do not run a real LLM provider"],
    requirements: [
      {
        id: "REQ-001",
        type: "explicit",
        statement: "Stop hook must aggregate review-agent evidence before deciding.",
        priority: "must"
      }
    ],
    acceptanceCriteria: [
      {
        id: "AC-001",
        requirementIds: ["REQ-001"],
        statement: "Missing review-agent lane evidence is generated and ingested inside one Stop hook decision.",
        verification: "stop hook review-agent eval",
        verificationType: "review_agent"
      }
    ],
    validationPlan: {
      dynamic: ["npm run devns -- eval run --mode M25_stop_hook_review_agent --json"],
      static: []
    },
    testCases: [
      {
        id: "TC-001",
        acceptanceCriteriaIds: ["AC-001"],
        type: "integration",
        scenario: "Run stop hook with one missing review-agent lane.",
        expected: "Review lane evidence is recorded before the final decision."
      }
    ],
    unknowns: [],
    risks: [],
    humanDecision: {
      status: "approved"
    }
  };
}

function evalFeature(id: string, patch: Partial<Feature> = {}): Feature {
  return {
    id,
    title: `${id} stop hook eval`,
    description: "Stop hook review-agent eval feature",
    status: "in_progress",
    priority: "P0",
    milestone: "Eval",
    risk: "medium",
    acceptanceCriteria: ["Review Agent lane evidence is generated before final stop decision."],
    verification: ["npm run devns -- eval run --mode M25_stop_hook_review_agent --json"],
    evidence: [],
    changedFiles: ["src/feature.ts"],
    reviewDecision: "pending",
    rfc: evalApprovedRfc(),
    ...patch
  };
}

async function writeStopHookReviewProject(cwd: string, input: { agentMode: "allow" | "block" }) {
  await mkdir(path.join(cwd, ".devns"), { recursive: true });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "feature.ts"), "export const feature = true;\n");
  await writeFile(
    path.join(cwd, "package.json"),
    `${JSON.stringify(
      {
        type: "module",
        scripts: {
          smoke: "echo smoke"
        }
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(cwd, ".devns", "devns.config.json"),
    `${JSON.stringify(
      {
        version: 1,
        features: ".devns/features.json",
        history: ".devns/history",
        completionPolicy: {
          mode: "queue",
          whenNoActiveFeature: "claim_next",
          whenNoClaimableFeature: "allow_stop",
          requireApprovedRfc: true,
          requireEvidence: true,
          requireReviewDecision: true,
          requireCleanWorktree: false,
          requireCommit: true
        },
        hooks: {
          stop: {
            mode: "gate",
            blockOn: {
              skippedRequiredVerification: true
            },
            reviewAgent: {
              mode: "run_missing",
              laneIds: ["code-review"],
              requireDeterministicEvidence: false
            }
          }
        },
        reviewLanes: [
          {
            id: "smoke-lane",
            type: "command",
            command: "npm run smoke",
            required: true,
            blocksCompletion: true
          },
          {
            id: "code-review",
            type: "agent",
            command: "node review-agent.mjs",
            required: true,
            blocksCompletion: true
          }
        ]
      } satisfies DevnsConfig,
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(cwd, ".devns", "features.json"),
    `${JSON.stringify(
      {
        project: {
          name: "Stop Hook Review Agent Eval",
          description: "Eval project for stop hook review-agent orchestration."
        },
        features: [evalFeature("M25-001")]
      } satisfies FeatureInventory,
      null,
      2
    )}\n`
  );

  const result =
    input.agentMode === "allow"
      ? {
          lane: "code-review",
          type: "agent",
          status: "pass",
          decision: "allow",
          summary: "Review Agent eval pass.",
          confidence: "high",
          findings: [],
          evidence: [
            {
              type: "review-context",
              summary: "Reviewed RFC, feature state, diff context, lane output, and project rules."
            }
          ],
          artifacts: [],
          recommendedActions: ["No blocking issue found; remaining proof is the configured smoke lane and commit metadata."],
          blocksCompletion: false,
          required: true
        }
      : {
          lane: "code-review",
          type: "agent",
          status: "fail",
          decision: "block",
          summary: "Review Agent eval found a blocking correctness issue.",
          confidence: "high",
          findings: [
            {
              severity: "error",
              category: "correctness",
              confidence: "high",
              file: "src/feature.ts",
              line: 1,
              message: "Feature violates the approved RFC.",
              evidence: [
                {
                  type: "diff",
                  summary: "The touched file implements behavior outside the approved acceptance criterion."
                }
              ],
              suggestedFix: "Align implementation with AC-001 before completion."
            }
          ],
          evidence: [
            {
              type: "review-context",
              summary: "Reviewed RFC and diff context before blocking."
            }
          ],
          artifacts: [],
          recommendedActions: ["Fix the correctness issue and rerun review."],
          blocksCompletion: true,
          required: true
        };

  await writeFile(path.join(cwd, "review-agent.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(result))});\n`);
}

async function readEvalFeature(cwd: string, featureId: string) {
  const inventory = await readJsonFile<FeatureInventory>(path.join(cwd, ".devns", "features.json"));
  const found = inventory.features.find((feature) => feature.id === featureId);
  if (!found) {
    throw new Error(`Missing eval feature ${featureId}.`);
  }
  return found;
}

async function readEvalStopLog(cwd: string) {
  try {
    const raw = await readFile(path.join(cwd, ".devns", "history", "stop-hook.jsonl"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
}

async function evaluateStopHookReviewAgent(given: Record<string, unknown>) {
  const scenario = stringValue(given.scenario) as StopHookReviewScenario;

  if (scenario === "recursion_guard") {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-stop-recursion-"));
    try {
      await writeStopHookReviewProject(cwd, { agentMode: "allow" });
      const result = await evaluateClaudeStopHook({ cwd, stop_hook_active: true });
      if (result.decision !== "allow" || !/already active/.test(result.reason)) {
        return {
          decision: "blocked" as const,
          reason: `Stop hook recursion guard failed: ${result.decision} ${result.reason}`
        };
      }
      return {
        decision: "allowed" as const,
        reason: "Stop hook recursion guard allowed recursive stop."
      };
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  if (!["review_agent_allows", "review_agent_blocks"].includes(scenario)) {
    return {
      decision: "blocked" as const,
      reason: "Stop hook review-agent gate failed: scenario must be review_agent_allows, review_agent_blocks, or recursion_guard."
    };
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-stop-review-"));
  try {
    await writeStopHookReviewProject(cwd, {
      agentMode: scenario === "review_agent_blocks" ? "block" : "allow"
    });
    const result = await evaluateClaudeStopHook({ cwd });
    const feature = await readEvalFeature(cwd, "M25-001");
    const stopLog = await readEvalStopLog(cwd);
    const evidence = feature.evidence ?? [];
    const hasCodeReviewEvidence = evidence.some(
      (item) => item.type === "lane:code-review" && item.actor === "review-agent:code-review"
    );
    const ranMissingReview = stopLog.some(
      (entry) =>
        entry.source === "core" &&
        entry.phase === "review_agent" &&
        entry.mode === "run_missing" &&
        entry.selectedFeatureId === "M25-001" &&
        Array.isArray(entry.laneIds) &&
        entry.laneIds.includes("code-review")
    );

    if (!ranMissingReview || !hasCodeReviewEvidence) {
      return {
        decision: "blocked" as const,
        reason: "Stop hook Review Agent did not write missing code-review lane evidence."
      };
    }

    if (scenario === "review_agent_allows") {
      const issues = [];
      if (result.decision !== "block") issues.push(`expected final stop decision block for remaining gates, got ${result.decision}`);
      if (/Required lane evidence is missing: code-review/.test(result.reason)) {
        issues.push("final reason still claims code-review evidence is missing");
      }
      if (/Review decision is still pending/.test(result.reason)) {
        issues.push("final reason still claims review decision is pending");
      }
      if (feature.reviewDecision !== "approved") {
        issues.push(`reviewDecision expected approved, got ${feature.reviewDecision ?? "missing"}`);
      }
      if (!/Required lane evidence is missing: smoke-lane/.test(result.reason)) {
        issues.push("final reason should still report the remaining deterministic smoke-lane gate");
      }

      return {
        decision: issues.length ? ("blocked" as const) : ("allowed" as const),
        reason: issues.length
          ? `Stop hook Review Agent allow orchestration failed: ${issues.join("; ")}.`
          : "Stop hook Review Agent allow orchestration passed with one unified final decision."
      };
    }

    const blockingEvidence = evidence.some((item) => item.type === "lane:code-review" && /Decision: block/.test(item.summary));
    if (
      result.decision === "block" &&
      feature.reviewDecision === "needs_changes" &&
      blockingEvidence &&
      /Required lane code-review is not clear to pass/.test(result.reason) &&
      /Review decision requires changes/.test(result.reason)
    ) {
      return {
        decision: "blocked" as const,
        reason: "Stop hook Review Agent lane blocked completion with grounded review evidence."
      };
    }

    return {
      decision: "allowed" as const,
      reason: "Stop hook Review Agent blocking lane was not enforced."
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function evaluateStateAtomicWrite(given: Record<string, unknown>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-state-"));
  try {
    const filePath = path.join(cwd, "features.json");
    const value = given.value ?? { project: { name: "Atomic", description: "Atomic" }, features: [] };
    for (const tempFile of (given.seedTempFiles ?? []) as string[]) {
      await writeFile(path.join(cwd, tempFile), "partial state\n");
    }
    await writeJsonFile(filePath, value);
    const roundTrip = await readJsonFile<unknown>(filePath);
    const files = await readdir(cwd);
    const tempFiles = files.filter((file) => file.startsWith(".features.json.tmp-"));
    const matches = JSON.stringify(roundTrip) === JSON.stringify(value);

    if (!matches || tempFiles.length) {
      return {
        decision: "blocked" as const,
        reason: [
          !matches ? "Atomic write round-trip did not preserve JSON value." : "",
          tempFiles.length ? `${tempFiles.length} temporary state file(s) remained after write.` : ""
        ]
          .filter(Boolean)
          .join(" ")
      };
    }

    return {
      decision: "allowed" as const,
      reason: "Atomic state write round-trip passed without temporary file leakage."
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function evaluateArtifactIntegrityGate(given: Record<string, unknown>, args: Record<string, unknown> = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-artifacts-"));
  try {
    for (const artifact of (given.artifacts ?? []) as Array<{ path: string; content: string | Record<string, unknown>; encoding?: "base64" }>) {
      const artifactPath = path.join(cwd, artifact.path);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      const content =
        artifact.encoding === "base64" && typeof artifact.content === "string"
          ? Buffer.from(artifact.content, "base64")
          : typeof artifact.content === "string"
            ? artifact.content
            : `${JSON.stringify(artifact.content, null, 2)}\n`;
      await writeFile(artifactPath, content);
    }
    const configPolicy = (given.config as DevnsConfig | undefined)?.artifactIntegrity?.browserSmoke ?? {};
    const report = await evaluateArtifactIntegrity(cwd, given.feature as Feature, {
      ...configPolicy,
      requireRichBrowserArtifacts:
        args.requireRichBrowserArtifacts === undefined ? configPolicy.requireRichBrowserArtifacts : Boolean(args.requireRichBrowserArtifacts),
      failOnConsoleError: args.failOnConsoleError === undefined ? configPolicy.failOnConsoleError : Boolean(args.failOnConsoleError),
      consoleErrorBudget: typeof args.consoleErrorBudget === "number" ? args.consoleErrorBudget : configPolicy.consoleErrorBudget,
      failOnNetworkError: args.failOnNetworkError === undefined ? configPolicy.failOnNetworkError : Boolean(args.failOnNetworkError),
      networkFailureBudget: typeof args.networkFailureBudget === "number" ? args.networkFailureBudget : configPolicy.networkFailureBudget,
      networkFailureStatus: typeof args.networkFailureStatus === "number" ? args.networkFailureStatus : configPolicy.networkFailureStatus,
      networkAllowedUrls: Array.isArray(args.networkAllowedUrls)
        ? args.networkAllowedUrls.filter((value): value is string => typeof value === "string")
        : configPolicy.networkAllowedUrls,
      networkBlockedUrls: Array.isArray(args.networkBlockedUrls)
        ? args.networkBlockedUrls.filter((value): value is string => typeof value === "string")
        : configPolicy.networkBlockedUrls
    });
    return {
      decision: report.decision === "block" ? ("blocked" as const) : ("allowed" as const),
      reason: report.summary
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function evaluateArtifactDigestGate(given: Record<string, unknown>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-artifact-digest-"));
  try {
    for (const artifact of (given.artifacts ?? []) as Array<{ path: string; content: string | Record<string, unknown>; encoding?: "base64" }>) {
      const artifactPath = path.join(cwd, artifact.path);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      const content =
        artifact.encoding === "base64" && typeof artifact.content === "string"
          ? Buffer.from(artifact.content, "base64")
          : typeof artifact.content === "string"
            ? artifact.content
            : `${JSON.stringify(artifact.content, null, 2)}\n`;
      await writeFile(artifactPath, content);
    }
    const refs = (given.artifactRefs ?? []) as string[];
    const policy = (given.config as DevnsConfig | undefined)?.artifactIntegrity?.browserSmoke;
    const digests = await buildArtifactDigests(cwd, refs, policy);
    const reason = digests.map((digest) => digest.summary).join(" ");
    return {
      decision: digests.some((digest) => digest.status === "missing") ? ("blocked" as const) : ("allowed" as const),
      reason
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writeEvalArtifacts(cwd: string, artifacts: EvalArtifact[]) {
  for (const artifact of artifacts) {
    const artifactPath = path.join(cwd, artifact.path);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    const content =
      artifact.encoding === "base64" && typeof artifact.content === "string"
        ? Buffer.from(artifact.content, "base64")
        : typeof artifact.content === "string"
          ? artifact.content
          : `${JSON.stringify(artifact.content, null, 2)}\n`;
    await writeFile(artifactPath, content);
  }
}

function substituteSeedValue(value: string, input: { repoRoot: string; seedRepo: string; attempt: number }) {
  return value
    .replaceAll("${repoRoot}", input.repoRoot)
    .replaceAll("${seedRepo}", input.seedRepo)
    .replaceAll("${attempt}", String(input.attempt));
}

async function runSeedCommand(seedRepo: string, repoRoot: string, command: SeedCommand, attempt: number) {
  const started = Date.now();
  const executable = substituteSeedValue(command.command, { repoRoot, seedRepo, attempt });
  const args = (command.args ?? []).map((arg) => substituteSeedValue(arg, { repoRoot, seedRepo, attempt }));
  const env = Object.fromEntries(
    Object.entries(command.env ?? {}).map(([key, value]) => [
      key,
      substituteSeedValue(value, { repoRoot, seedRepo, attempt })
    ])
  );
  const expectedExitCode = command.expectedExitCode ?? 0;

  try {
    const result = await execFileAsync(executable, args, {
      cwd: seedRepo,
      env: {
        ...process.env,
        DEVNS_REPO: seedRepo,
        DEVNS_T3_ATTEMPT: String(attempt),
        ...env
      },
      timeout: command.timeoutMs ?? 30_000,
      maxBuffer: 2 * 1024 * 1024
    });
    return {
      ok: expectedExitCode === 0,
      exitCode: 0,
      elapsedMs: Date.now() - started,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
      failureClass: expectedExitCode === 0 ? undefined : command.failureClass ?? "unexpected_command_success"
    };
  } catch (error) {
    const exitCode = typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1;
    return {
      ok: exitCode === expectedExitCode,
      exitCode,
      elapsedMs: Date.now() - started,
      stdoutBytes: typeof (error as { stdout?: unknown }).stdout === "string" ? ((error as { stdout: string }).stdout.length) : 0,
      stderrBytes: typeof (error as { stderr?: unknown }).stderr === "string" ? ((error as { stderr: string }).stderr.length) : 0,
      failureClass: exitCode === expectedExitCode ? undefined : command.failureClass ?? "command_exit_mismatch"
    };
  }
}

async function evaluateSeedArtifacts(seedRepo: string, artifacts: SeedExpectedArtifact[]) {
  const failures: string[] = [];
  const failureClasses: string[] = [];

  for (const artifact of artifacts) {
    const artifactPath = path.join(seedRepo, artifact.path);
    let content: string;
    try {
      content = await readFile(artifactPath, "utf8");
    } catch {
      failures.push(`Missing expected seed artifact ${artifact.path}.`);
      failureClasses.push(artifact.failureClass ?? "artifact_missing");
      continue;
    }

    for (const expected of Array.isArray(artifact.contains) ? artifact.contains : artifact.contains ? [artifact.contains] : []) {
      if (!content.includes(expected)) {
        failures.push(`Seed artifact ${artifact.path} does not contain ${JSON.stringify(expected)}.`);
        failureClasses.push(artifact.failureClass ?? "artifact_content_mismatch");
      }
    }
  }

  return { failures, failureClasses };
}

async function evaluateSeedRepository(given: Record<string, unknown>, repoRoot = process.cwd()) {
  const seed = recordValue(given.seedRepository ?? given.seed);
  if (!seed) {
    return {
      decision: "blocked" as const,
      reason: "Seed repository gate failed: missing seedRepository object.",
      metadata: { t3: { failureTaxonomy: ["missing_seed_repository"] } }
    };
  }

  const seedRepo = await mkdtemp(path.join(os.tmpdir(), "devns-eval-t3-"));
  const started = Date.now();
  try {
    await writeEvalArtifacts(seedRepo, (seed.files ?? []) as EvalArtifact[]);
    const attempts = Math.max(1, Math.floor(numberValue(seed.attempts, 1)));
    const k = Math.max(1, Math.floor(numberValue(seed.passK, 1)));
    const commands = (seed.commands ?? []) as SeedCommand[];
    const commandResults = [];
    let commandSuccesses = 0;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const results = [];
      for (const command of commands) {
        results.push(await runSeedCommand(seedRepo, repoRoot, command, attempt));
      }
      commandResults.push({ attempt, results });
      if (results.every((result) => result.ok)) {
        commandSuccesses += 1;
      }
    }

    const artifactCheck = await evaluateSeedArtifacts(seedRepo, (seed.expectedArtifacts ?? []) as SeedExpectedArtifact[]);
    const artifactPassed = artifactCheck.failures.length === 0;
    const successes = artifactPassed ? commandSuccesses : 0;
    const commandFailureClasses = commandResults.flatMap((attempt) =>
      attempt.results.flatMap((result) => (result.failureClass ? [result.failureClass] : []))
    );
    const failureTaxonomy = [...new Set([...commandFailureClasses, ...artifactCheck.failureClasses])];
    const blocked = successes < attempts;
    const elapsedMs = Date.now() - started;
    const passExponentK = passK(successes, attempts, Math.min(k, attempts));
    const estimatedCostUsd = numberValue(seed.estimatedCostUsd, 0);
    const metadata = {
      t3: {
        seedId: stringValue(seed.id) || "seed",
        projectType: stringValue(seed.projectType) || "unknown",
        riskArea: stringValue(seed.riskArea) || "unknown",
        attempts,
        successes,
        commandSuccesses,
        artifactPassed,
        passK: passExponentK,
        k: Math.min(k, attempts),
        elapsedMs,
        estimatedCostUsd,
        failureTaxonomy: failureTaxonomy.length ? failureTaxonomy : ["none"],
        commandResults
      }
    };
    const reason = [
      `Seed repository ${metadata.t3.seedId}: attempts=${attempts}; successes=${successes}; pass^${metadata.t3.k}=${passExponentK.toFixed(3)}; elapsedMs=${elapsedMs}; estimatedCostUsd=${estimatedCostUsd.toFixed(4)}.`,
      failureTaxonomy.length ? `Failure taxonomy: ${failureTaxonomy.join(", ")}.` : "Failure taxonomy: none.",
      artifactCheck.failures.join(" ")
    ]
      .filter(Boolean)
      .join(" ");

    return {
      decision: blocked ? ("blocked" as const) : ("allowed" as const),
      reason,
      metadata
    };
  } finally {
    await rm(seedRepo, { recursive: true, force: true });
  }
}

async function evaluateDashboardArtifactPreviewGate(given: Record<string, unknown>) {
  if (Array.isArray(given.artifactRefs) || Array.isArray(given.artifacts)) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-eval-dashboard-preview-"));
    try {
      await writeEvalArtifacts(cwd, (given.artifacts ?? []) as EvalArtifact[]);
      const policy = (given.config as DevnsConfig | undefined)?.artifactIntegrity?.browserSmoke;
      const audit = await auditDashboardArtifactPreviewArtifacts(cwd, (given.artifactRefs ?? []) as string[], policy, String(given.visibleText ?? ""));
      return {
        decision: audit.decision === "allow" ? ("allowed" as const) : ("blocked" as const),
        reason: audit.summary
      };
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  const audit = auditDashboardArtifactPreview({
    artifactDigests: (given.artifactDigests ?? []) as ArtifactDigest[],
    visibleText: String(given.visibleText ?? "")
  });
  return {
    decision: audit.decision === "allow" ? ("allowed" as const) : ("blocked" as const),
    reason: audit.summary
  };
}

export async function runT1Case(testCase: EvalCase): Promise<EvalCaseOutcome> {
  let result: { decision: EvalDecision; reason: string };

  if (testCase.action.gate === "completion_independent_review") {
    const feature = testCase.given.feature as Feature;
    const review = ((testCase.action.args?.review as ReviewDecision | undefined) ?? "approved") as ReviewDecision;
    const gate = evaluateCompletionGate(feature, { review });
    result = { decision: gate.decision, reason: gate.reason };
  } else if (testCase.action.gate === "candidate_provenance") {
    result = evaluateCandidateProvenance(testCase.given);
  } else if (testCase.action.gate === "scope_guard") {
    result = await evaluateScopeGuard(testCase.given);
  } else if (testCase.action.gate === "evidence_quality") {
    result = evaluateEvidenceQualityGate(testCase.given);
  } else if (testCase.action.gate === "artifact_integrity") {
    result = await evaluateArtifactIntegrityGate(testCase.given, testCase.action.args);
  } else if (testCase.action.gate === "artifact_digest") {
    result = await evaluateArtifactDigestGate(testCase.given);
  } else if (testCase.action.gate === "dashboard_artifact_preview") {
    result = await evaluateDashboardArtifactPreviewGate(testCase.given);
  } else if (testCase.action.gate === "orchestrator_trace") {
    result = evaluateOrchestratorTrace(testCase.given);
  } else if (testCase.action.gate === "context_budget") {
    result = evaluateContextBudgetGate(testCase.given);
  } else if (testCase.action.gate === "project_extension_config") {
    result = await evaluateProjectExtensionConfig(testCase.given);
  } else if (testCase.action.gate === "host_adapter_init") {
    result = await evaluateHostAdapterInit(testCase.given);
  } else if (testCase.action.gate === "stop_hook_review_agent") {
    result = await evaluateStopHookReviewAgent(testCase.given);
  } else if (testCase.action.gate === "state_atomic_write") {
    result = await evaluateStateAtomicWrite(testCase.given);
  } else {
    result = evaluateReviewLaneResult(testCase.given, testCase.expect);
  }

  const reasonMatches = testCase.expect.reasonContains ? result.reason.includes(testCase.expect.reasonContains) : true;
  return {
    id: testCase.id,
    tier: testCase.tier,
    mode: testCase.mode,
    expected: testCase.expect.decision,
    actual: result.decision,
    reason: result.reason,
    pass: result.decision === testCase.expect.decision && reasonMatches
  };
}

export async function runT2Case(testCase: EvalCase): Promise<EvalCaseOutcome> {
  const result =
    testCase.action.gate === "review_lane_result"
      ? evaluateReviewLaneResult(testCase.given, testCase.expect)
      : testCase.action.gate === "review_calibration_result"
        ? evaluateReviewCalibrationResult(testCase.given, testCase.expect)
      : testCase.action.gate === "review_adapter_execution"
        ? await evaluateReviewAdapterExecution(testCase.given, testCase.expect)
      : testCase.action.gate === "review_packet_quality"
        ? evaluateReviewPacketQuality(testCase.given)
        : {
            decision: "blocked" as const,
            reason: `T2 gate ${testCase.action.gate} is not implemented.`
          };
  const reasonMatches = testCase.expect.reasonContains ? result.reason.includes(testCase.expect.reasonContains) : true;
  return {
    id: testCase.id,
    tier: testCase.tier,
    mode: testCase.mode,
    expected: testCase.expect.decision,
    actual: result.decision,
    reason: result.reason,
    pass: result.decision === testCase.expect.decision && reasonMatches
  };
}

export async function runT3Case(testCase: EvalCase, repoRoot = process.cwd()): Promise<EvalCaseOutcome> {
  const result =
    testCase.action.gate === "seed_repository"
      ? await evaluateSeedRepository(testCase.given, repoRoot)
      : {
          decision: "blocked" as const,
          reason: `T3 gate ${testCase.action.gate} is not implemented.`,
          metadata: {}
        };
  const reasonMatches = testCase.expect.reasonContains ? result.reason.includes(testCase.expect.reasonContains) : true;
  return {
    id: testCase.id,
    tier: testCase.tier,
    mode: testCase.mode,
    expected: testCase.expect.decision,
    actual: result.decision,
    reason: result.reason,
    pass: result.decision === testCase.expect.decision && reasonMatches,
    metadata: result.metadata
  };
}

export async function loadEvalCases(rootDir: string) {
  const cases: EvalCase[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const parsed = JSON.parse(await readFile(fullPath, "utf8")) as EvalCase;
        const validation = validateSchema(parsed, evalCaseSchema);
        if (!validation.valid) {
          throw new Error(`Eval case ${fullPath} failed schema validation:\n${validation.errors.join("\n")}`);
        }
        cases.push(parsed);
      }
    }
  }
  await walk(rootDir);
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
