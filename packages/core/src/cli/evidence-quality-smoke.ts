#!/usr/bin/env node
import assert from "node:assert/strict";
import { evaluateEvidenceQuality } from "../harness/evidence-quality";
import type { Feature } from "../harness/types";

function feature(evidence: Feature["evidence"]): Feature {
  return {
    id: "EQ-001",
    title: "Evidence quality smoke",
    description: "Ensure product ACs are not covered by build alone.",
    status: "in_progress",
    priority: "P0",
    milestone: "Smoke",
    acceptanceCriteria: ["The first screen exposes the feature-specific user workflow labels."],
    evidence,
    rfc: {
      status: "approved",
      summary: "Verify product semantics.",
      background: "Build output alone cannot prove product semantics.",
      featureDescription: "Show the intended user-facing workflow.",
      expectedOutcome: "The first screen uses feature-specific workflow language.",
      goals: ["Product semantics"],
      nonGoals: ["Generic SaaS metrics"],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Use feature-specific user workflow labels", priority: "must" }],
      acceptanceCriteria: [
        {
          id: "AC-001",
          requirementIds: ["REQ-001"],
          statement: "The first screen exposes the feature-specific user workflow labels.",
          verificationType: "browser_smoke"
        }
      ],
      validationPlan: { dynamic: ["browser smoke"], static: ["review text labels"] },
      testCases: [{ id: "TC-001", acceptanceCriteriaIds: ["AC-001"], type: "e2e", scenario: "Open the app", expected: "Workflow labels are visible" }],
      humanDecision: { status: "approved" }
    }
  };
}

const buildOnly = evaluateEvidenceQuality(feature([{ type: "lane:build", summary: "Build passed." }]));
assert.equal(buildOnly.decision, "needs_human_review");
assert.equal(buildOnly.coverage[0]?.covered, false);

const falselyClaimed = evaluateEvidenceQuality(
  feature([
    {
      type: "lane:build",
      summary: "Build passed and claimed browser coverage.",
      coversAcceptanceCriteriaIds: ["AC-001"],
      verificationType: "command"
    }
  ])
);
assert.equal(falselyClaimed.decision, "needs_human_review");
assert.equal(falselyClaimed.coverage[0]?.covered, false);
assert.match(falselyClaimed.summary, /incompatible verification type/);

const browserCovered = evaluateEvidenceQuality(
  feature([
    { type: "lane:build", summary: "Build passed." },
    {
      type: "browser",
      summary: "Observed the feature-specific workflow labels.",
      coversAcceptanceCriteriaIds: ["AC-001"],
      verificationType: "browser_smoke"
    }
  ])
);
assert.equal(browserCovered.decision, "allow");
assert.equal(browserCovered.coverage[0]?.covered, true);

process.stdout.write("Evidence quality smoke passed.\n");
