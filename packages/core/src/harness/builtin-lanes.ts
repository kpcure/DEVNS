import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { evaluateEvidenceQuality } from "./evidence-quality";
import type { Feature } from "./types";
import { decisionForFindings, findingBlocksCompletion, type LaneDefinition, type LaneFinding, type LaneResult } from "./lane-runner";

const execAsync = promisify(exec);

export type BuiltinLaneContext = {
  cwd: string;
  feature?: Feature;
  changedFiles?: string[];
};

type BuiltinLaneHandler = (lane: LaneDefinition, context: BuiltinLaneContext) => Promise<LaneResult>;

const sensitivePathPatterns = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)auth/i,
  /(^|\/)security/i,
  /(^|\/)config/i
];

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{12,}["']/i
];

function resultFor(
  lane: LaneDefinition,
  status: LaneResult["status"],
  summary: string,
  findings: LaneFinding[],
  options: {
    evidence?: LaneResult["evidence"];
    recommendedActions?: string[];
    blocksCompletion?: boolean;
    confidence?: LaneResult["confidence"];
  } = {}
): LaneResult {
  const decision = status === "pass" || status === "fail" ? decisionForFindings(findings, lane) : "needs_human_review";
  const blocksCompletion = options.blocksCompletion ?? decision === "block";

  return {
    lane: lane.id,
    type: "builtin",
    status,
    decision,
    summary,
    confidence: options.confidence ?? "high",
    findings,
    evidence: options.evidence ?? [],
    artifacts: [],
    recommendedActions: options.recommendedActions ?? [],
    blocksCompletion,
    required: lane.required ?? false
  };
}

async function listChangedFiles(cwd: string) {
  try {
    const { stdout } = await execAsync("git diff --name-only HEAD --", { cwd });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function resolveChangedFiles(context: BuiltinLaneContext) {
  return context.changedFiles ?? (await listChangedFiles(context.cwd));
}

function expectedSurfaces(feature?: Feature) {
  return new Set([...(feature?.implementationSurface ?? []), ...(feature?.changedFiles ?? [])]);
}

function matchesExpectedSurface(file: string, expected: Set<string>) {
  if (expected.size === 0) {
    return true;
  }

  for (const surface of expected) {
    if (file === surface || file.startsWith(`${surface}/`) || surface.startsWith(file)) {
      return true;
    }
  }
  return false;
}

export async function runScopeGuard(lane: LaneDefinition, context: BuiltinLaneContext) {
  const changedFiles = await resolveChangedFiles(context);
  const expected = expectedSurfaces(context.feature);
  const outOfScope = changedFiles.filter((file) => !matchesExpectedSurface(file, expected));
  const sensitiveChanges = changedFiles.filter((file) => sensitivePathPatterns.some((pattern) => pattern.test(file)));
  const findings: LaneFinding[] = [
    ...outOfScope.map((file) => ({
      severity: "error" as const,
      message: `Changed file is outside declared feature surface: ${file}`,
      category: "scope" as const,
      confidence: "high" as const,
      file,
      evidence: [
        {
          type: "diff" as const,
          summary: `${file} appears in the working diff but is not declared in feature implementationSurface or changedFiles.`
        }
      ],
      suggestedFix: "Add the file to the feature impact surface or split unrelated work into another feature."
    })),
    ...sensitiveChanges.map((file) => ({
      severity: "warning" as const,
      message: `Sensitive or configuration-adjacent file changed: ${file}`,
      category: "security" as const,
      confidence: "medium" as const,
      file
    }))
  ];
  const blocksCompletion = findings.some(findingBlocksCompletion) && (lane.blocksCompletion ?? true);

  return resultFor(
    lane,
    blocksCompletion ? "fail" : "pass",
    blocksCompletion
      ? `${outOfScope.length} changed file(s) are outside declared feature surface.`
      : `Scope guard checked ${changedFiles.length} changed file(s).`,
    findings,
    {
      blocksCompletion,
      evidence: [
        {
          type: "changed-files",
          summary: `${changedFiles.length} changed file(s) inspected.`
        }
      ],
      recommendedActions: blocksCompletion
        ? ["Add changed files to the feature impact surface or split unrelated work into another feature."]
        : []
    }
  );
}

export async function runReviewabilityGate(lane: LaneDefinition, context: BuiltinLaneContext) {
  const feature = context.feature;
  const findings: LaneFinding[] = [];

  if (!feature) {
    findings.push({ severity: "error", message: "No active feature was provided to reviewability gate." });
  } else {
    if (!feature.acceptanceCriteria?.length) {
      findings.push({
        severity: "error",
        message: "Feature has no acceptance criteria.",
        category: "reviewability",
        confidence: "high",
        evidence: [{ type: "requirement", summary: "Feature acceptanceCriteria is empty." }],
        suggestedFix: "Add acceptance criteria before implementation can be reviewed."
      });
    }
    if (!feature.evidence?.length) {
      findings.push({
        severity: "error",
        message: "Feature has no evidence.",
        category: "reviewability",
        confidence: "high",
        evidence: [{ type: "artifact", summary: "Feature evidence array is empty." }],
        suggestedFix: "Run verification and record evidence before completion."
      });
    }
    if (!feature.agentNotes?.trim()) {
      findings.push({ severity: "warning", message: "Feature has no agent notes.", category: "reviewability", confidence: "medium" });
    }
    if (!feature.changedFiles?.length) {
      findings.push({ severity: "warning", message: "Feature has no changedFiles evidence.", category: "reviewability", confidence: "medium" });
    }
  }

  const blocking = findings.some(findingBlocksCompletion) && (lane.blocksCompletion ?? true);
  return resultFor(
    lane,
    blocking ? "fail" : "pass",
    blocking ? "Reviewability gate found missing required review evidence." : "Reviewability gate passed.",
    findings,
    {
      blocksCompletion: blocking,
      evidence: feature
        ? [
            {
              type: "reviewability",
              summary: `Checked ${feature.acceptanceCriteria?.length ?? 0} acceptance criteria and ${feature.evidence?.length ?? 0} evidence item(s).`
            }
          ]
        : [],
      recommendedActions: blocking ? ["Record acceptance criteria coverage and verification evidence before completion."] : []
    }
  );
}

async function readChangedFileContents(cwd: string, files: string[]) {
  const contents: Array<{ file: string; content: string }> = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(cwd, file), "utf8");
      contents.push({ file, content });
    } catch {
      // Deleted or binary files are skipped by the lightweight scanner.
    }
  }
  return contents;
}

export async function runSecurityScan(lane: LaneDefinition, context: BuiltinLaneContext) {
  const changedFiles = await resolveChangedFiles(context);
  const contents = await readChangedFileContents(context.cwd, changedFiles);
  const findings: LaneFinding[] = [];

  for (const item of contents) {
    for (const pattern of secretPatterns) {
      if (pattern.test(item.content)) {
        findings.push({
          severity: "error",
          message: `Potential secret detected in ${item.file}.`,
          category: "security",
          confidence: "high",
          file: item.file,
          evidence: [{ type: "source", summary: `Secret-like pattern matched in ${item.file}.` }],
          suggestedFix: "Remove the suspected secret and rotate the credential if it was real."
        });
        break;
      }
    }
  }

  for (const file of changedFiles) {
    if (sensitivePathPatterns.some((pattern) => pattern.test(file))) {
      findings.push({
        severity: "warning",
        message: `Security-sensitive or configuration-adjacent file changed: ${file}.`,
        category: "security",
        confidence: "medium",
        file
      });
    }
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const blocksCompletion = hasError && (lane.blocksCompletion ?? true);
  return resultFor(
    lane,
    hasError ? "fail" : "pass",
    blocksCompletion
      ? "Security scan found blocking findings."
      : hasError
        ? "Security scan found nonblocking findings."
        : "Security scan found no blocking findings.",
    findings,
    {
      blocksCompletion,
      evidence: [
        {
          type: "security-scan",
          summary: `Scanned ${contents.length} changed text file(s) for secret patterns.`
        }
      ],
      recommendedActions: blocksCompletion ? ["Remove the suspected secret and rotate the credential if it was real."] : []
    }
  );
}

export async function runEvidenceQualityGate(lane: LaneDefinition, context: BuiltinLaneContext) {
  const feature = context.feature;
  if (!feature) {
    return resultFor(
      lane,
      "fail",
      "Evidence quality gate needs an active or selected feature.",
      [
        {
          severity: "error",
          message: "No feature was provided to the evidence quality gate.",
          category: "reviewability",
          confidence: "high",
          evidence: [{ type: "requirement", summary: "Evidence quality is feature-scoped." }],
          suggestedFix: "Run the lane with an active feature or pass --feature <id>."
        }
      ],
      {
        blocksCompletion: lane.blocksCompletion ?? true,
        recommendedActions: ["Run `npx devns lanes run --feature <id> --write` after verification evidence exists."]
      }
    );
  }

  const report = evaluateEvidenceQuality(feature);
  const findings: LaneFinding[] = report.findings.map((finding) => ({
    severity: finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "info",
    message: finding.message,
    category: "reviewability",
    confidence: finding.severity === "error" ? "high" : "medium",
    evidence: [{ type: "artifact", summary: `Evidence quality decision: ${report.decision}.` }],
    suggestedFix: finding.suggestedFix
  }));
  const blocksCompletion = report.decision === "block" && (lane.blocksCompletion ?? true);

  return resultFor(
    lane,
    blocksCompletion ? "fail" : "pass",
    report.summary,
    findings,
    {
      blocksCompletion,
      evidence: [
        {
          type: "evidence-quality",
          summary: `${report.coverage.filter((item) => item.covered).length}/${report.coverage.length} acceptance criteria covered. Decision: ${report.decision}.`
        }
      ],
      recommendedActions: report.findings.flatMap((finding) => (finding.suggestedFix ? [finding.suggestedFix] : []))
    }
  );
}

const handlers: Record<string, BuiltinLaneHandler> = {
  "scope-guard": runScopeGuard,
  "reviewability-gate": runReviewabilityGate,
  "evidence-quality-gate": runEvidenceQualityGate,
  "evidence_quality": runEvidenceQualityGate,
  security_basic: runSecurityScan,
  "security-scan": runSecurityScan,
  "security-sensor": runSecurityScan
};

export async function runBuiltinLane(lane: LaneDefinition, context: BuiltinLaneContext): Promise<LaneResult> {
  const handler = handlers[lane.id];
  if (!handler) {
    return resultFor(lane, "skipped", `No builtin lane handler is registered for ${lane.id}.`, [], {
      confidence: "medium"
    });
  }
  return handler(lane, context);
}
