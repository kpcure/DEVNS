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
    acceptanceCriteria: ["Dashboard uses librarian-specific catalog, loan, member, and overdue labels."],
    evidence,
    rfc: {
      status: "approved",
      summary: "Verify library semantics.",
      background: "Build output alone cannot prove product semantics.",
      featureDescription: "Show a librarian workbench.",
      expectedOutcome: "The first screen uses library-specific workflow language.",
      goals: ["Library semantics"],
      nonGoals: ["Generic SaaS metrics"],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Use library domain labels", priority: "must" }],
      acceptanceCriteria: [
        {
          id: "AC-001",
          requirementIds: ["REQ-001"],
          statement: "Dashboard uses librarian-specific catalog, loan, member, and overdue labels.",
          verificationType: "browser_smoke"
        }
      ],
      validationPlan: { dynamic: ["browser smoke"], static: ["review text labels"] },
      testCases: [{ id: "TC-001", acceptanceCriteriaIds: ["AC-001"], type: "e2e", scenario: "Open dashboard", expected: "Library labels are visible" }],
      humanDecision: { status: "approved" }
    }
  };
}

const buildOnly = evaluateEvidenceQuality(feature([{ type: "lane:build", summary: "Build passed." }]));
assert.equal(buildOnly.decision, "needs_human_review");
assert.equal(buildOnly.coverage[0]?.covered, false);

const browserCovered = evaluateEvidenceQuality(
  feature([
    { type: "lane:build", summary: "Build passed." },
    {
      type: "browser",
      summary: "Observed catalog, loan, member, and overdue labels.",
      coversAcceptanceCriteriaIds: ["AC-001"],
      verificationType: "browser_smoke"
    }
  ])
);
assert.equal(browserCovered.decision, "allow");
assert.equal(browserCovered.coverage[0]?.covered, true);

process.stdout.write("Evidence quality smoke passed.\n");
