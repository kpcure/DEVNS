import type { Evidence, Feature, RfcAcceptanceCriterion, VerificationType } from "./types";

export type EvidenceQualityDecision = "allow" | "warn" | "block" | "needs_human_review";

export type EvidenceCoverage = {
  criterionId: string;
  criterion: string;
  evidence: Evidence[];
  covered: boolean;
  verificationType: VerificationType;
  requiresHumanReview: boolean;
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

function evidenceLooksReview(evidence: Evidence) {
  return /review|review-agent|code-review|human/i.test(evidence.type) || evidence.verificationType === "review_agent" || evidence.verificationType === "human_review";
}

function evidenceLooksManual(evidence: Evidence) {
  return /manual|assertion|human/i.test(evidence.type) || /manual|visually checked|looked at/i.test(evidence.summary);
}

function evidenceLooksBrowser(evidence: Evidence) {
  return /browser|e2e|playwright|selenium|visual/i.test(evidence.type) || evidence.verificationType === "browser_smoke";
}

function evidenceHasArtifactRef(evidence: Evidence) {
  return Boolean(evidence.url || evidence.artifactRefs?.length);
}

function criterionNeedsTraceableSemanticEvidence(criterion: { verificationType: VerificationType }) {
  return ["browser_smoke", "human_review", "review_agent"].includes(criterion.verificationType);
}

function criterionLooksProductSemantic(value: string) {
  return /user|screen|page|dashboard|ui|ux|label|semantic|workflow|workbench|visible|display|show|journey|interaction|业务|语义|首屏|看板|页面|用户|展示|交互|流程/i.test(value);
}

function inferCriterionVerificationType(criterion: Pick<RfcAcceptanceCriterion, "statement" | "verification" | "verificationType">): VerificationType {
  if (criterion.verificationType) return criterion.verificationType;
  const text = `${criterion.statement} ${criterion.verification ?? ""}`;
  if (/review agent|code review|static review|人工审查|代码审查/i.test(text)) return "review_agent";
  if (/browser|playwright|selenium|e2e|visual|screenshot|页面|浏览器/i.test(text)) return "browser_smoke";
  if (/human|manual|人工|手动/i.test(text)) return "human_review";
  if (/build|lint|test|typecheck|command|npm|pnpm|yarn|tsc|vitest|jest|schema/i.test(text)) return "command";
  if (/static|security|scope|diff/i.test(text)) return "static_review";
  return criterionLooksProductSemantic(text) ? "human_review" : "review_agent";
}

function acceptanceCriteriaFor(feature: Feature) {
  if (feature.rfc?.acceptanceCriteria?.length) {
    return feature.rfc.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      requirementIds: criterion.requirementIds ?? [],
      verificationType: inferCriterionVerificationType(criterion)
    }));
  }

  return (feature.acceptanceCriteria ?? []).map((criterion, index) => ({
    id: `AC-${String(index + 1).padStart(3, "0")}`,
    statement: criterion,
    requirementIds: [],
    verificationType: inferCriterionVerificationType({ statement: criterion })
  }));
}

function evidenceDirectlyCovers(evidence: Evidence, criterion: ReturnType<typeof acceptanceCriteriaFor>[number]) {
  if (evidence.coversAcceptanceCriteriaIds?.includes(criterion.id)) return true;
  if (criterion.requirementIds.some((id) => evidence.coversRequirementIds?.includes(id))) return true;
  return false;
}

function evidenceKindMatches(evidence: Evidence, criterion: ReturnType<typeof acceptanceCriteriaFor>[number]) {
  if (criterion.verificationType === "command") {
    return evidence.verificationType ? evidence.verificationType === "command" : evidenceLooksDeterministic(evidence) && !evidenceLooksReview(evidence) && !evidenceLooksManual(evidence);
  }
  if (criterion.verificationType === "static_review") {
    return evidence.verificationType
      ? ["static_review", "review_agent"].includes(evidence.verificationType)
      : evidenceLooksReview(evidence) || /lint|static|security|scope|typecheck/i.test(evidence.type);
  }
  if (criterion.verificationType === "browser_smoke") {
    return evidence.verificationType
      ? ["browser_smoke", "human_review", "review_agent"].includes(evidence.verificationType)
      : evidenceLooksBrowser(evidence) || evidenceLooksManual(evidence) || evidenceLooksReview(evidence);
  }
  if (criterion.verificationType === "human_review") {
    return evidence.verificationType
      ? ["human_review", "review_agent", "browser_smoke"].includes(evidence.verificationType)
      : evidenceLooksManual(evidence) || evidenceLooksReview(evidence) || evidenceLooksBrowser(evidence);
  }
  return evidence.verificationType ? evidence.verificationType === "review_agent" : evidenceLooksReview(evidence);
}

function evidenceTypeCovers(evidence: Evidence, criterion: ReturnType<typeof acceptanceCriteriaFor>[number]) {
  if (evidenceDirectlyCovers(evidence, criterion)) return evidenceKindMatches(evidence, criterion);
  if (criterion.verificationType === "command") {
    return evidenceLooksDeterministic(evidence) && !["git", "security-scan"].includes(evidence.type);
  }
  if (criterion.verificationType === "static_review") {
    return evidenceLooksReview(evidence) || /lint|static|security|scope|typecheck|lane:/i.test(evidence.type);
  }
  if (criterion.verificationType === "browser_smoke") {
    return evidenceLooksBrowser(evidence) || evidenceLooksReview(evidence) || evidenceLooksManual(evidence);
  }
  if (criterion.verificationType === "human_review") {
    return evidenceLooksManual(evidence) || evidenceLooksReview(evidence) || evidenceLooksBrowser(evidence);
  }
  return evidenceLooksReview(evidence);
}

export function evaluateEvidenceQuality(feature: Feature): EvidenceQualityReport {
  const evidence = feature.evidence ?? [];
  const deterministic = evidence.filter(evidenceLooksDeterministic);
  const semantic = evidence.filter((item) => evidenceLooksBrowser(item) || evidenceLooksReview(item));
  const manual = evidence.filter(evidenceLooksManual);
  const criteria = acceptanceCriteriaFor(feature);
  const findings: EvidenceQualityReport["findings"] = [];

  if (!evidence.length) {
    findings.push({ severity: "error", message: "Feature has no evidence.", suggestedFix: "Run verification lanes and record at least one deterministic evidence item." });
  }

  if (!deterministic.length && !semantic.length && evidence.length) {
    findings.push({
      severity: "warning",
      message: "Evidence exists, but none is deterministic command, lane, git, browser, static, or independent semantic evidence.",
      suggestedFix: "Add command, lane, build, test, lint, browser, static, dynamic, git, or review-agent evidence."
    });
  }

  if (manual.length && manual.length === evidence.length) {
    findings.push({
      severity: "warning",
      message: "Only manual evidence is present; route to human review before allowing completion.",
      suggestedFix: "Add deterministic evidence or keep the feature in human review."
    });
  }

  if (!criteria.length) {
    findings.push({
      severity: "error",
      message: "Feature has no acceptance criteria to verify.",
      suggestedFix: "Add acceptance criteria before completing the feature."
    });
  }

  const coverage = criteria.map((criterion) => {
    const supporting = evidence.filter((item) => evidenceTypeCovers(item, criterion));
    return {
      criterionId: criterion.id,
      criterion: criterion.statement,
      evidence: supporting,
      covered: supporting.length > 0,
      verificationType: criterion.verificationType,
      requiresHumanReview: ["browser_smoke", "human_review", "review_agent"].includes(criterion.verificationType)
    };
  });

  const traceabilityGaps = coverage.flatMap((criterionCoverage) =>
    criterionNeedsTraceableSemanticEvidence(criterionCoverage)
      ? criterionCoverage.evidence
          .filter((item) => (evidenceLooksBrowser(item) || evidenceLooksReview(item) || evidenceLooksManual(item)) && !evidenceHasArtifactRef(item))
          .map((item) => ({ criterion: criterionCoverage, evidence: item }))
      : []
  );
  if (traceabilityGaps.length) {
    const uniqueEvidence = new Set(traceabilityGaps.map((item) => `${item.evidence.type}\n${item.evidence.summary}`));
    findings.push({
      severity: "warning",
      message: `${uniqueEvidence.size} semantic evidence item(s) lack artifactRefs or url.`,
      suggestedFix: "Attach review packets, browser-smoke artifacts, screenshots, logs, or an external review URL to semantic evidence."
    });
  }

  const incompatibleClaims = criteria.flatMap((criterion) =>
    evidence
      .filter((item) => evidenceDirectlyCovers(item, criterion) && !evidenceKindMatches(item, criterion))
      .map((item) => ({ criterion, evidence: item }))
  );
  if (incompatibleClaims.length) {
    findings.push({
      severity: "warning",
      message: `${incompatibleClaims.length} evidence coverage claim(s) use an incompatible verification type.`,
      suggestedFix: "Use evidence whose verificationType matches the acceptance criterion, such as browser_smoke for browser criteria or review_agent for review criteria."
    });
  }

  const uncovered = coverage.filter((item) => !item.covered);
  if (uncovered.length) {
    findings.push({
      severity: uncovered.some((item) => item.requiresHumanReview) ? "warning" : "error",
      message: `${uncovered.length} acceptance criterion/criteria have no supporting evidence.`,
      suggestedFix: "Record evidence with coversAcceptanceCriteriaIds/coversRequirementIds or route the feature to human/review-agent inspection."
    });
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const uncoveredReview = uncovered.some((item) => item.requiresHumanReview);
  const decision: EvidenceQualityDecision = hasError
    ? "block"
    : uncoveredReview || traceabilityGaps.length || (manual.length === evidence.length && evidence.length)
      ? "needs_human_review"
      : hasWarning
        ? "warn"
        : "allow";

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
