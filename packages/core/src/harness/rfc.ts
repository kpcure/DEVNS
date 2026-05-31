import type { CandidateFeature, Feature, FeatureRfc, RfcClarificationQuestion } from "./types";

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

function isBlank(value: string | undefined) {
  return !value || !value.trim();
}

function hasRequirementCoverage(rfc: FeatureRfc, requirementId: string) {
  return rfc.acceptanceCriteria.some((criterion) => criterion.requirementIds?.includes(requirementId));
}

function hasAcceptanceCoverage(rfc: FeatureRfc, criterionId: string) {
  return rfc.testCases.some((testCase) => testCase.acceptanceCriteriaIds?.includes(criterionId));
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

  if (rfc.humanDecision?.status !== "approved") {
    reasons.push(`Human RFC decision is ${rfc.humanDecision?.status ?? "missing"}, not approved.`);
  }

  if (isBlank(rfc.summary)) {
    reasons.push("RFC summary is empty.");
  }

  if (isBlank(rfc.background)) {
    reasons.push("RFC background is empty.");
  }

  if (isBlank(rfc.featureDescription)) {
    reasons.push("RFC feature description is empty.");
  }

  if (isBlank(rfc.expectedOutcome)) {
    reasons.push("RFC expected outcome is empty.");
  }

  if (!hasItems(rfc.goals)) {
    reasons.push("RFC goals are missing.");
  }

  if (!hasItems(rfc.requirements)) {
    reasons.push("RFC requirements are missing.");
  }

  if (!hasItems(rfc.nonGoals)) {
    reasons.push("RFC non-goals are missing.");
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

  for (const requirement of rfc.requirements.filter((item) => item.priority === "must")) {
    if (!hasRequirementCoverage(rfc, requirement.id)) {
      reasons.push(`Must requirement ${requirement.id} is not covered by acceptance criteria.`);
    }
  }

  for (const criterion of rfc.acceptanceCriteria) {
    if (!hasAcceptanceCoverage(rfc, criterion.id) && isBlank(criterion.verification)) {
      reasons.push(`Acceptance criterion ${criterion.id} has no test case or verification target.`);
    }
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
    clarificationQuestions: createClarificationQuestions({
      background: "",
      expectedOutcome: "",
      nonGoals: [],
      validationPlan: {
        dynamic: [],
        static: []
      }
    }),
    risks: [],
    humanDecision: {
      status: "pending"
    }
  };
}

export function createClarificationQuestions(rfc: Pick<FeatureRfc, "background" | "expectedOutcome" | "nonGoals" | "validationPlan">): RfcClarificationQuestion[] {
  const questions: RfcClarificationQuestion[] = [];

  if (isBlank(rfc.background)) {
    questions.push({
      id: "Q-INTENT-001",
      question: "What project or user problem should this feature solve?",
      recommended: "Define the concrete user/project problem before implementation.",
      options: [
        "Define the concrete user/project problem before implementation.",
        "Treat this as a technical maintenance task with no direct user-facing problem.",
        "Defer this feature until the problem statement is clearer."
      ],
      blocking: true,
      owner: "human"
    });
  }

  if (!hasItems(rfc.nonGoals)) {
    questions.push({
      id: "Q-SCOPE-001",
      question: "Which tempting but out-of-scope behavior should this feature explicitly avoid?",
      recommended: "Record at least one non-goal so the implementation does not expand silently.",
      options: [
        "Record at least one non-goal so the implementation does not expand silently.",
        "This feature is small enough that no non-goal is needed.",
        "Split the feature because the boundary is not clear."
      ],
      blocking: true,
      owner: "human"
    });
  }

  if (isBlank(rfc.expectedOutcome)) {
    questions.push({
      id: "Q-OUTCOME-001",
      question: "What observable outcome proves this feature is complete?",
      recommended: "Define a user-visible or state-visible outcome that can become an acceptance criterion.",
      options: [
        "Define a user-visible or state-visible outcome that can become an acceptance criterion.",
        "Define a developer-visible outcome such as command output, schema validation, or generated artifact.",
        "Defer until success can be observed."
      ],
      blocking: true,
      owner: "human"
    });
  }

  if (!hasAnyValidationPlan(rfc as FeatureRfc)) {
    questions.push({
      id: "Q-VERIFY-001",
      question: "Which verification path should block completion?",
      recommended: "Use the narrowest deterministic command or inspection that proves the acceptance criteria.",
      options: [
        "Use the narrowest deterministic command or inspection that proves the acceptance criteria.",
        "Use static review only for this feature.",
        "Require manual review because deterministic validation is not available yet."
      ],
      blocking: true,
      owner: "agent"
    });
  }

  return questions.slice(0, 5);
}
