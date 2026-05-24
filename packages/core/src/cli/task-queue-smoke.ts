#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { claimFeature, completeFeature, releaseFeature } from "../harness/task-queue";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { FeatureRfc } from "../harness/types";

const approvedRfc: FeatureRfc = {
  status: "approved",
  summary: "Approved smoke RFC",
  background: "Smoke test background",
  featureDescription: "Smoke test feature",
  expectedOutcome: "Feature can be claimed",
  goals: ["Verify claim"],
  nonGoals: [],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "Feature can be claimed only with an approved RFC.",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "Claim succeeds for approved RFC."
    }
  ],
  validationPlan: {
    dynamic: ["Run task queue smoke."],
    static: ["Inspect event trail."]
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "unit",
      scenario: "Claim a ready feature with approved RFC.",
      expected: "Feature becomes in_progress."
    }
  ],
  unknowns: [],
  risks: [],
  humanDecision: {
    status: "approved"
  }
};

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-task-queue-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "Task Queue Smoke",
      projectDescription: "Smoke test workspace"
    });

    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features.push(
      {
        id: "SMOKE-001",
        title: "Claimable feature",
        description: "Has an approved RFC",
        status: "ready",
        priority: "P1",
        milestone: "Smoke",
        acceptanceCriteria: ["Can be claimed"],
        rfc: approvedRfc
      },
      {
        id: "SMOKE-002",
        title: "Blocked by missing RFC",
        description: "Does not have an RFC",
        status: "ready",
        priority: "P0",
        milestone: "Smoke",
        acceptanceCriteria: ["Cannot be claimed without RFC"]
      }
    );
    await writeInventory(cwd, config, inventory);

    await assert.rejects(() => claimFeature(cwd, config, "SMOKE-002"), /RFC is missing/);

    const claimed = await claimFeature(cwd, config, "SMOKE-001", { by: "smoke" });
    assert.equal(claimed?.feature.status, "in_progress");
    assert.equal(claimed?.feature.events?.at(-1)?.type, "claimed");

    await assert.rejects(() => claimFeature(cwd, config, "SMOKE-001"), /already in progress/);

    const released = await releaseFeature(cwd, config, "SMOKE-001", { by: "smoke" });
    assert.equal(released.feature.status, "ready");

    await claimFeature(cwd, config, "SMOKE-001", { by: "smoke" });
    const completed = await completeFeature(
      cwd,
      config,
      "SMOKE-001",
      [{ type: "smoke", summary: "Task Queue smoke evidence" }],
      { by: "smoke" }
    );
    assert.equal(completed.feature.status, "done");
    assert.equal(completed.feature.events?.at(-1)?.type, "completed");

    process.stdout.write("Task Queue smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown task queue smoke error"}\n`);
  process.exitCode = 1;
});
