import { evaluateEvidenceQuality, type EvidenceQualityDecision } from "./evidence-quality";
import type { Evidence, Feature, ReviewDecision } from "./types";

export type CompletionGateDecision = "allowed" | "blocked";

export type CompletionGateResult = {
  decision: CompletionGateDecision;
  reason: string;
  implementer?: string;
  independentReviewEvidence?: Evidence;
  evidenceQualityDecision: EvidenceQualityDecision;
};

export type CompletionGateOptions = {
  review: ReviewDecision;
  force?: boolean;
  evidenceQualityDecision?: EvidenceQualityDecision;
};

export function lastImplementer(feature: Feature) {
  const claimed = [...(feature.events ?? [])].reverse().find((event) => event.type === "claimed" && event.by);
  return claimed?.by;
}

function isReviewEvidence(evidence: Evidence) {
  return (
    ["review_agent", "human_review", "browser_smoke"].includes(evidence.verificationType ?? "") ||
    /review|human|manual|browser|e2e|visual/i.test(evidence.type)
  );
}

export function findIndependentReviewEvidence(feature: Feature) {
  const implementer = lastImplementer(feature);
  const evidence = (feature.evidence ?? []).find(
    (item) =>
      isReviewEvidence(item) &&
      Boolean(item.actor) &&
      (!implementer || item.actor !== implementer) &&
      (item.artifactRefs?.length ?? 0) > 0
  );

  return { implementer, evidence };
}

export function evaluateCompletionGate(feature: Feature, options: CompletionGateOptions): CompletionGateResult {
  const evidenceQualityDecision = options.evidenceQualityDecision ?? evaluateEvidenceQuality(feature).decision;
  const { implementer, evidence } = findIndependentReviewEvidence(feature);

  if (
    options.review === "approved" &&
    (evidenceQualityDecision === "needs_human_review" || !evidence) &&
    !options.force
  ) {
    return {
      decision: "blocked",
      reason:
        "approved completion requires independent review evidence: actor must differ from the implementer and include artifactRefs.",
      implementer,
      independentReviewEvidence: evidence,
      evidenceQualityDecision
    };
  }

  return {
    decision: "allowed",
    reason: "Completion gate passed.",
    implementer,
    independentReviewEvidence: evidence,
    evidenceQualityDecision
  };
}
