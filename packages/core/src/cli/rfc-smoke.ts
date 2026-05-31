#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateRfcReadiness, createRfcScaffold, createClarificationQuestions } from "../harness/rfc";
import type { Feature, FeatureRfc } from "../harness/types";

const approvedRfc: FeatureRfc = {
  status: "approved",
  summary: "Approved smoke RFC",
  background: "A clear problem exists.",
  featureDescription: "Implement the smoke behavior.",
  expectedOutcome: "The smoke behavior is observable.",
  goals: ["Implement smoke behavior"],
  nonGoals: ["Do not implement unrelated behavior"],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "WHEN smoke input is present THE SYSTEM SHALL produce smoke output.",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "Given smoke input, when the command runs, then smoke output is produced."
    }
  ],
  validationPlan: {
    dynamic: ["npm run rfc:smoke --silent"],
    static: []
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "unit",
      scenario: "Smoke input is present.",
      expected: "Smoke output is produced."
    }
  ],
  unknowns: [],
  humanDecision: {
    status: "approved"
  }
};

function feature(rfc: FeatureRfc): Feature {
  return {
    id: "RFC-SMOKE",
    title: "RFC smoke",
    description: "RFC smoke",
    status: "ready",
    priority: "P0",
    milestone: "Smoke",
    acceptanceCriteria: ["Smoke acceptance"],
    rfc
  };
}

const ready = evaluateRfcReadiness(feature(approvedRfc));
assert.equal(ready.ready, true);

const missingHumanDecision = evaluateRfcReadiness(feature({ ...approvedRfc, humanDecision: undefined }));
assert.equal(missingHumanDecision.ready, false);
assert.match(missingHumanDecision.reasons.join("\n"), /Human RFC decision is missing/);

const missingCoverage = evaluateRfcReadiness(
  feature({
    ...approvedRfc,
    acceptanceCriteria: [{ id: "AC-001", statement: "Unmapped acceptance" }],
    testCases: []
  })
);
assert.equal(missingCoverage.ready, false);
assert.match(missingCoverage.reasons.join("\n"), /Must requirement REQ-001/);
assert.match(missingCoverage.reasons.join("\n"), /test case candidates are missing/);

const scaffold = createRfcScaffold({
  id: "CAND-001",
  title: "Smoke candidate",
  description: "Smoke candidate description"
});
assert.ok(scaffold.clarificationQuestions?.length);
assert.ok(scaffold.clarificationQuestions?.every((question) => question.options.length >= 2));

const generatedQuestions = createClarificationQuestions({ ...approvedRfc, nonGoals: [], expectedOutcome: "" });
assert.ok(generatedQuestions.some((question) => question.id === "Q-SCOPE-001"));
assert.ok(generatedQuestions.some((question) => question.id === "Q-OUTCOME-001"));

process.stdout.write("RFC smoke passed.\n");
