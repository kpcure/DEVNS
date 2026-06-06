import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateCompletionGate } from "../packages/core/src/harness/completion-gate";
import { evaluateEvidenceQuality } from "../packages/core/src/harness/evidence-quality";
import { evaluateArtifactIntegrity } from "../packages/core/src/harness/artifact-integrity";
import { buildArtifactDigests, type ArtifactDigest } from "../packages/core/src/harness/artifact-digest";
import {
  auditDashboardArtifactPreview,
  auditDashboardArtifactPreviewArtifacts
} from "../packages/core/src/harness/dashboard-artifact-preview";
import { runScopeGuard } from "../packages/core/src/harness/builtin-lanes";
import { findingBlocksCompletion, type LaneFinding, type LaneResult } from "../packages/core/src/harness/lane-runner";
import { auditOrchestratorTraces, type OrchestratorTraceRecord } from "../packages/core/src/harness/orchestrator-trace";
import { readJsonFile, writeJsonFile } from "../packages/core/src/harness/state";
import type { CandidateFeature, DevnsConfig, Feature, ReviewDecision } from "../packages/core/src/harness/types";
import { validateSchema } from "../packages/core/src/harness/schema-validator";
import evalCaseSchema from "../tools/schema/eval-case.schema.json";
import laneResultSchema from "../tools/schema/lane-result.schema.json";

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

function evaluateOrchestratorTrace(given: Record<string, unknown>) {
  const records = ((given.records ?? (given.record ? [given.record] : [])) as OrchestratorTraceRecord[]);
  const audit = auditOrchestratorTraces(records);
  return {
    decision: audit.decision === "pass" ? ("allowed" as const) : ("blocked" as const),
    reason: audit.findings.length ? audit.findings.map((finding) => finding.message).join(" ") : "Orchestrator trace audit passed."
  };
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
