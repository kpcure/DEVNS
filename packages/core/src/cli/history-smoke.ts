#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { appendExecutionHistory, buildChangedFileEvidence, buildHumanChangeRecord, laneResultsToChecks } from "../harness/history";
import { readConfig } from "../harness/state";
import type { Feature } from "../harness/types";
import type { LaneResult } from "../harness/lane-runner";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-history-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "History Smoke",
      projectDescription: "Smoke test workspace"
    });
    const config = await readConfig(cwd);

    const feature: Feature = {
      id: "HIST-001",
      title: "History feature",
      description: "Record history",
      status: "in_progress",
      priority: "P0",
      milestone: "Smoke",
      acceptanceCriteria: ["History exists"],
      changedFiles: ["src/history.ts"]
    };

    const laneResult: LaneResult = {
      lane: "unit",
      type: "command",
      status: "pass",
      decision: "allow",
      summary: "Unit command passed.",
      confidence: "high",
      findings: [],
      evidence: [],
      artifacts: [],
      recommendedActions: [],
      blocksCompletion: false,
      required: true,
      exitCode: 0
    };
    const checks = laneResultsToChecks([laneResult]);
    const first = await appendExecutionHistory(cwd, config, {
      featureId: feature.id,
      actor: "agent",
      summary: "Implemented history smoke.",
      decisions: ["Store curated knowledge separately from raw lane output."],
      alternativesRejected: ["Do not store full terminal transcripts in the compact feature inventory."],
      changedFiles: buildChangedFileEvidence(feature, {
        "src/history.ts": "Implements execution history append."
      }),
      impact: ["History records can be appended."],
      pitfalls: [
        {
          summary: "Verbose logs make history hard for future agents to scan.",
          cause: "Mixing raw execution output with durable project knowledge.",
          prevention: "Keep raw lane envelopes in JSONL and summarize reusable lessons in dedicated fields."
        }
      ],
      errors: [
        {
          summary: "Fixture schema drift would hide missing history sections.",
          fix: "Assert the curated fields in the smoke test."
        }
      ],
      fixes: ["Normalize missing curated history fields to empty arrays."],
      lessons: ["Future agents should read pitfalls and lessons before editing files for a feature."],
      risks: ["Schema is still v0.1."],
      dynamicChecks: checks.dynamicChecks,
      staticChecks: checks.staticChecks,
      laneResults: [laneResult]
    });

    assert.equal(first.summary.recordCount, 1);
    assert.equal(first.record.changedFiles[0]?.acceptanceCriteria?.[0], "History exists");
    assert.equal(first.record.dynamicChecks[0]?.status, "passed");
    assert.match(first.record.decisions[0] ?? "", /curated knowledge/);
    assert.match(first.record.alternativesRejected[0] ?? "", /terminal transcripts/);
    assert.equal(first.record.pitfalls[0]?.prevention, "Keep raw lane envelopes in JSONL and summarize reusable lessons in dedicated fields.");
    assert.equal(first.record.errors[0]?.fix, "Assert the curated fields in the smoke test.");
    assert.equal(first.record.fixes[0], "Normalize missing curated history fields to empty arrays.");
    assert.match(first.record.lessons[0] ?? "", /read pitfalls/);

    const second = await appendExecutionHistory(
      cwd,
      config,
      buildHumanChangeRecord(feature.id, {
        changedBy: "human",
        changedAt: "2026-05-24T00:00:00.000Z",
        fields: ["status"],
        summary: "Human marked feature blocked.",
        reason: "Need product clarification."
      })
    );
    assert.equal(second.summary.recordCount, 2);
    assert.equal(second.record.humanChange?.fields[0], "status");
    assert.deepEqual(second.record.decisions, []);

    const historyFile = path.join(cwd, second.summary.historyPath);
    const lines = (await readFile(historyFile, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(await readFile(path.join(cwd, "AGENTS.md"), "utf8"), /.devns\/history/);

    process.stdout.write("Execution history smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown history smoke error"}\n`);
  process.exitCode = 1;
});
