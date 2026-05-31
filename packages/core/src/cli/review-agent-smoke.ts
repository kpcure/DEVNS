#!/usr/bin/env node
import assert from "node:assert/strict";
import laneResultSchema from "../../../../tools/schema/lane-result.schema.json";
import { decisionForFindings, type LaneDefinition, type LaneResult } from "../harness/lane-runner";
import { validateSchema } from "../harness/schema-validator";

function resultFromFindings(lane: LaneDefinition, findings: LaneResult["findings"]): LaneResult {
  const decision = decisionForFindings(findings, lane);
  return {
    lane: lane.id,
    type: "agent",
    status: decision === "allow" ? "pass" : "fail",
    decision,
    summary: `Read-only review agent produced ${findings.length} finding(s).`,
    confidence: "high",
    findings,
    evidence: [
      {
        type: "review-agent",
        summary: "Fixture review result was generated without code edits."
      }
    ],
    artifacts: [],
    recommendedActions: findings.flatMap((finding) => (finding.suggestedFix ? [finding.suggestedFix] : [])),
    blocksCompletion: decision === "block",
    required: lane.required ?? false
  };
}

async function main() {
  const lane: LaneDefinition = {
    id: "code-review",
    type: "agent",
    agent: "devns-code-reviewer",
    required: true,
    blocksCompletion: true
  };

  const blocking = resultFromFindings(lane, [
    {
      severity: "error",
      category: "correctness",
      confidence: "high",
      file: "packages/core/src/harness/task-queue.ts",
      line: 174,
      requirementIds: ["REQ-002"],
      message: "Completion can proceed without preserving required verification evidence.",
      evidence: [
        {
          type: "diff",
          summary: "The changed branch removes the evidence length check before completion."
        }
      ],
      suggestedFix: "Restore the evidence gate or add an equivalent explicit lane evidence check."
    }
  ]);

  const lowConfidence = resultFromFindings(lane, [
    {
      severity: "error",
      category: "maintainability",
      confidence: "low",
      file: "apps/dashboard/src/main.tsx",
      message: "This may duplicate an existing helper, but the fixture has no diff evidence.",
      suggestedFix: "Ask a human reviewer to confirm whether this is real duplication."
    }
  ]);

  assert.equal(blocking.decision, "block");
  assert.equal(blocking.blocksCompletion, true);
  assert.equal(lowConfidence.decision, "needs_human_review");
  assert.equal(lowConfidence.blocksCompletion, false);

  for (const result of [blocking, lowConfidence]) {
    const validation = validateSchema(result, laneResultSchema);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
  }

  process.stdout.write("Review agent contract smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown review agent smoke error"}\n`);
  process.exitCode = 1;
});
