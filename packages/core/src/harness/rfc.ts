import type { CandidateFeature, Feature, FeatureRfc } from "./types";

export type RfcReadiness =
  | {
      ready: true;
      reasons: [];
    }
  | {
      ready: false;
      reasons: string[];
    };

function hasItems(value: unknown[] | undefined) {
  return Array.isArray(value) && value.length > 0;
}

function hasAnyValidationPlan(rfc: FeatureRfc) {
  return hasItems(rfc.validationPlan.dynamic) || hasItems(rfc.validationPlan.static);
}

export function evaluateRfcReadiness(feature: Feature): RfcReadiness {
  const reasons: string[] = [];
  const { rfc } = feature;

  if (!rfc) {
    return {
      ready: false,
      reasons: ["RFC is missing."]
    };
  }

  if (rfc.status !== "approved") {
    reasons.push(`RFC status is ${rfc.status}, not approved.`);
  }

  if (rfc.humanDecision?.status && rfc.humanDecision.status !== "approved") {
    reasons.push(`Human RFC decision is ${rfc.humanDecision.status}, not approved.`);
  }

  if (!rfc.summary.trim()) {
    reasons.push("RFC summary is empty.");
  }

  if (!rfc.background.trim()) {
    reasons.push("RFC background is empty.");
  }

  if (!rfc.featureDescription.trim()) {
    reasons.push("RFC feature description is empty.");
  }

  if (!rfc.expectedOutcome.trim()) {
    reasons.push("RFC expected outcome is empty.");
  }

  if (!hasItems(rfc.goals)) {
    reasons.push("RFC goals are missing.");
  }

  if (!hasItems(rfc.requirements)) {
    reasons.push("RFC requirements are missing.");
  }

  if (!hasItems(rfc.acceptanceCriteria)) {
    reasons.push("RFC acceptance criteria are missing.");
  }

  if (!hasAnyValidationPlan(rfc)) {
    reasons.push("RFC validation plan has no dynamic or static checks.");
  }

  if (!hasItems(rfc.testCases)) {
    reasons.push("RFC test case candidates are missing.");
  }

  const blockingUnknowns = rfc.unknowns?.filter((unknown) => unknown.severity === "blocking") ?? [];
  if (blockingUnknowns.length > 0) {
    reasons.push(`RFC has ${blockingUnknowns.length} blocking unknown(s).`);
  }

  return reasons.length ? { ready: false, reasons } : { ready: true, reasons: [] };
}

export function canClaimFeature(feature: Feature) {
  if (feature.status !== "ready") {
    return {
      ready: false,
      reasons: [`Feature status is ${feature.status}, not ready.`]
    } satisfies RfcReadiness;
  }

  return evaluateRfcReadiness(feature);
}

export function describeRfcBlock(feature: Feature, readiness = canClaimFeature(feature)) {
  if (readiness.ready) {
    return `Feature ${feature.id} has an approved RFC and can be claimed.`;
  }

  return [
    `Feature ${feature.id} cannot be claimed because its RFC gate is not satisfied.`,
    ...readiness.reasons.map((reason) => `- ${reason}`)
  ].join("\n");
}

export function createRfcScaffold(input: Pick<CandidateFeature, "id" | "title" | "description">): FeatureRfc {
  const title = input.title?.trim() || input.id;
  const description = input.description?.trim() || "Describe the feature behavior and expected outcome.";

  return {
    status: "draft",
    summary: `Clarify ${title}.`,
    background: "",
    featureDescription: description,
    expectedOutcome: "",
    goals: [],
    nonGoals: [],
    requirements: [
      {
        id: "REQ-001",
        type: "explicit",
        statement: description,
        source: input.id,
        priority: "must"
      }
    ],
    acceptanceCriteria: [
      {
        id: "AC-001",
        requirementIds: ["REQ-001"],
        statement: "",
        verification: ""
      }
    ],
    validationPlan: {
      dynamic: [],
      static: []
    },
    testCases: [
      {
        id: "TC-001",
        acceptanceCriteriaIds: ["AC-001"],
        type: "unit",
        scenario: "",
        expected: ""
      }
    ],
    unknowns: [],
    risks: [],
    humanDecision: {
      status: "pending"
    }
  };
}
