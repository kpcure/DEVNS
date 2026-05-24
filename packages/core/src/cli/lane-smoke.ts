#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { laneResultsToEvidence, runReviewLanes } from "../harness/lane-runner";
import type { NeverStopConfig } from "../harness/types";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-lanes-"));

  try {
    await writeFile(path.join(cwd, "pass.mjs"), "process.stdout.write('ok')\n");
    await writeFile(path.join(cwd, "fail.mjs"), "process.stderr.write('bad'); process.exit(7)\n");

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
        }
      ]
    };

    const summary = await runReviewLanes(config, cwd);
    assert.equal(summary.results.length, 3);
    assert.equal(summary.results[0]?.status, "pass");
    assert.equal(summary.results[0]?.exitCode, 0);
    assert.equal(summary.results[1]?.status, "fail");
    assert.equal(summary.results[1]?.exitCode, 7);
    assert.equal(summary.results[1]?.blocksCompletion, true);
    assert.equal(summary.results[2]?.status, "skipped");
    assert.equal(summary.results[2]?.blocksCompletion, false);
    assert.equal(summary.blocksCompletion, true);
    assert.match(summary.continuationReason ?? "", /fail-command/);
    assert.equal(laneResultsToEvidence(summary.results).length, 3);

    process.stdout.write("Lane runner smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown lane smoke error"}\n`);
  process.exitCode = 1;
});
