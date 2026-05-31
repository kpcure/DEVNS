#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { appendExecutionHistory } from "../harness/history";
import { writeMorningReviewReport } from "../harness/morning-review";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { Feature } from "../harness/types";

function doneFeature(id: string, changedFiles: string[]): Feature {
  return {
    id,
    title: `${id} feature`,
    description: "Fixture feature",
    status: "done",
    priority: "P1",
    milestone: "Smoke",
    risk: id.endsWith("2") ? "high" : "medium",
    acceptanceCriteria: ["Criterion has evidence"],
    verification: ["fixture"],
    evidence: [
      { type: "lane:unit", summary: "Lane unit passed. Decision: allow." },
      { type: "git", summary: `Committed ${changedFiles.length} file(s).` }
    ],
    changedFiles,
    commit: `${id.toLowerCase()}abc`,
    reviewDecision: "approved",
    rfc: {
      status: "approved",
      summary: `${id} RFC intent`,
      background: "Fixture background",
      featureDescription: "Fixture description",
      expectedOutcome: "Fixture outcome",
      goals: ["Grouped review"],
      nonGoals: [],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Need report", priority: "must" }],
      acceptanceCriteria: [{ id: "AC-001", statement: "Criterion has evidence" }],
      validationPlan: { dynamic: ["fixture"], static: [] },
      testCases: [{ id: "TC-001", type: "unit", scenario: "Generate", expected: "Report exists" }],
      humanDecision: { status: "approved" }
    }
  };
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-morning-review-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({ force: false, projectName: "Morning Review Smoke", projectDescription: "Smoke" });
    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features = [
      doneFeature("REV-001", ["src/shared.ts", "src/a.ts"]),
      doneFeature("REV-002", ["src/shared.ts", "src/b.ts"])
    ];
    await writeInventory(cwd, config, inventory);

    await appendExecutionHistory(cwd, config, {
      featureId: "REV-001",
      actor: "agent",
      summary: "Implemented REV-001.",
      decisions: ["Use feature packets instead of commit-only review."],
      alternativesRejected: [],
      changedFiles: [],
      impact: ["Morning review can summarize a feature."],
      pitfalls: [{ summary: "Commit-only review hides feature intent." }],
      errors: [],
      fixes: ["Group evidence under the feature id."],
      lessons: ["Read RFC intent before inspecting diffs."],
      risks: [],
      dynamicChecks: [],
      staticChecks: []
    });

    const result = await writeMorningReviewReport(cwd, "2026-05-30");
    assert.equal(result.report.summary.featureCount, 2);
    assert.equal(result.report.crossFeatureRisks[0], "src/shared.ts changed by REV-002, REV-001");
    assert.match(result.report.packets.find((packet) => packet.featureId === "REV-001")?.lessons[0] ?? "", /RFC intent/);

    const json = JSON.parse(await readFile(path.join(cwd, result.jsonPath), "utf8"));
    assert.equal(json.packets.length, 2);
    assert.match(await readFile(path.join(cwd, result.markdownPath), "utf8"), /Morning Review 2026-05-30/);

    process.stdout.write("Morning review smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown morning review smoke error"}\n`);
  process.exitCode = 1;
});
