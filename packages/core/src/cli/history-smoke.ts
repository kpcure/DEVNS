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
      summary: "Unit command passed.",
      confidence: "high",
      findings: [],
      evidence: [],
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
      changedFiles: buildChangedFileEvidence(feature, {
        "src/history.ts": "Implements execution history append."
      }),
      impact: ["History records can be appended."],
      risks: ["Schema is still v0.1."],
      dynamicChecks: checks.dynamicChecks,
      staticChecks: checks.staticChecks,
      laneResults: [laneResult]
    });

    assert.equal(first.summary.recordCount, 1);
    assert.equal(first.record.changedFiles[0]?.acceptanceCriteria?.[0], "History exists");
    assert.equal(first.record.dynamicChecks[0]?.status, "passed");

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
