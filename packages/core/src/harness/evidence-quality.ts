import type { Evidence, Feature } from "./types";

export type EvidenceQualityDecision = "allow" | "warn" | "block" | "needs_human_review";

export type EvidenceCoverage = {
  criterion: string;
  evidence: Evidence[];
  covered: boolean;
};

export type EvidenceQualityReport = {
  featureId: string;
  decision: EvidenceQualityDecision;
  summary: string;
  coverage: EvidenceCoverage[];
  findings: Array<{
    severity: "info" | "warning" | "error";
    message: string;
    suggestedFix?: string;
  }>;
};

function evidenceLooksDeterministic(evidence: Evidence) {
  return (
    evidence.type.startsWith("lane:") ||
    ["command", "git", "build", "test", "lint", "browser", "static", "dynamic", "security-scan"].includes(evidence.type)
  );
}

function evidenceLooksManual(evidence: Evidence) {
  return /manual|assertion|human/i.test(evidence.type) || /manual|visually checked|looked at/i.test(evidence.summary);
}

export function evaluateEvidenceQuality(feature: Feature): EvidenceQualityReport {
  const evidence = feature.evidence ?? [];
  const deterministic = evidence.filter(evidenceLooksDeterministic);
  const manual = evidence.filter(evidenceLooksManual);
  const findings: EvidenceQualityReport["findings"] = [];

  if (!evidence.length) {
    findings.push({ severity: "error", message: "Feature has no evidence.", suggestedFix: "Run verification lanes and record at least one deterministic evidence item." });
  }

  if (!deterministic.length && evidence.length) {
    findings.push({
      severity: "warning",
      message: "Evidence exists, but none is deterministic command, lane, git, browser, or static evidence.",
      suggestedFix: "Add command, lane, build, test, lint, browser, static, dynamic, or git evidence."
    });
  }

  if (manual.length && manual.length === evidence.length) {
    findings.push({
      severity: "warning",
      message: "Only manual evidence is present; route to human review before allowing completion.",
      suggestedFix: "Add deterministic evidence or keep the feature in human review."
    });
  }

  if (!(feature.acceptanceCriteria ?? []).length) {
    findings.push({
      severity: "error",
      message: "Feature has no acceptance criteria to verify.",
      suggestedFix: "Add acceptance criteria before completing the feature."
    });
  }

  const coverage = (feature.acceptanceCriteria ?? []).map((criterion) => ({
    criterion,
    evidence: deterministic.length ? deterministic : evidence,
    covered: deterministic.length > 0 || evidence.length > 0
  }));

  const uncovered = coverage.filter((item) => !item.covered);
  if (uncovered.length) {
    findings.push({
      severity: "error",
      message: `${uncovered.length} acceptance criterion/criteria have no supporting evidence.`,
      suggestedFix: "Record evidence that maps to the feature acceptance criteria."
    });
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const decision: EvidenceQualityDecision = hasError ? "block" : manual.length === evidence.length && evidence.length ? "needs_human_review" : hasWarning ? "warn" : "allow";

  return {
    featureId: feature.id,
    decision,
    summary:
      decision === "allow"
        ? `Evidence quality passed for ${coverage.length} acceptance criterion/criteria.`
        : `Evidence quality needs attention: ${findings.map((finding) => finding.message).join(" ")}`,
    coverage,
    findings
  };
}
