#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { laneResultsToEvidence, runReviewLanes } from "../harness/lane-runner";
import type { Feature, NeverStopConfig } from "../harness/types";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-lanes-"));

  try {
    await writeFile(path.join(cwd, "pass.mjs"), "process.stdout.write('ok')\n");
    await writeFile(path.join(cwd, "fail.mjs"), "process.stderr.write('bad'); process.exit(7)\n");
    await writeFile(path.join(cwd, "secret.txt"), "api_key = '12345678901234567890'\n");

    const config: NeverStopConfig = {
      version: 1,
      features: ".devns/features.json",
      reviewLanes: [
        {
          id: "pass-command",
          type: "command",
          command: "node pass.mjs",
          required: true,
          blocksCompletion: true
        },
        {
          id: "fail-command",
          type: "command",
          command: "node fail.mjs",
          required: true,
          blocksCompletion: true
        },
        {
          id: "agent-schema-only",
          type: "agent",
          agent: "codeReviewer",
          required: true,
          blocksCompletion: true
        },
        {
          id: "scope-guard",
          type: "builtin",
          required: true,
          blocksCompletion: true
        },
        {
          id: "reviewability-gate",
          type: "builtin",
          required: true,
          blocksCompletion: true
        },
        {
          id: "security-scan",
          type: "builtin",
          required: true,
          blocksCompletion: true
        }
      ]
    };

    const feature: Feature = {
      id: "SMOKE-001",
      title: "Smoke feature",
      description: "Verify builtin lanes",
      status: "in_progress",
      priority: "P0",
      milestone: "Smoke",
      risk: "high",
      context: ["pass.mjs"],
      acceptanceCriteria: ["Lanes produce evidence"],
      evidence: [{ type: "smoke", summary: "Evidence is present." }],
      changedFiles: ["pass.mjs"],
      agentNotes: "Smoke notes"
    };

    const summary = await runReviewLanes(config, cwd, {
      feature,
      changedFiles: ["pass.mjs", "secret.txt"]
    });
    assert.equal(summary.results.length, 6);
    assert.equal(summary.results[0]?.status, "pass");
    assert.equal(summary.results[0]?.exitCode, 0);
    assert.equal(summary.results[1]?.status, "fail");
    assert.equal(summary.results[1]?.exitCode, 7);
    assert.equal(summary.results[1]?.blocksCompletion, true);
    assert.equal(summary.results[2]?.status, "skipped");
    assert.equal(summary.results[2]?.blocksCompletion, false);
    assert.equal(summary.results[3]?.status, "fail");
    assert.match(summary.results[3]?.summary ?? "", /outside declared feature surface/);
    assert.equal(summary.results[4]?.status, "pass");
    assert.equal(summary.results[5]?.status, "fail");
    assert.match(summary.results[5]?.summary ?? "", /Security scan/);
    assert.equal(summary.blocksCompletion, true);
    assert.match(summary.continuationReason ?? "", /fail-command/);
    assert.equal(laneResultsToEvidence(summary.results).length, 6);

    process.stdout.write("Lane runner smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown lane smoke error"}\n`);
  process.exitCode = 1;
});
