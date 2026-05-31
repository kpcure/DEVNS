#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initWorkspace } from "./init";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { FeatureRfc } from "../harness/types";

const execFileAsync = promisify(execFile);

const approvedRfc: FeatureRfc = {
  status: "approved",
  summary: "Approved run smoke RFC",
  background: "Smoke test background",
  featureDescription: "Smoke test feature",
  expectedOutcome: "Feature can be handed to a worker.",
  goals: ["Verify run handoff"],
  nonGoals: ["Do not implement unrelated queue behavior."],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "Run CLI should emit an isolated worker handoff for a claimable feature.",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "JSON output contains workerHandoff."
    }
  ],
  validationPlan: {
    dynamic: ["Run run CLI smoke."],
    static: ["Inspect JSON payload."]
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "unit",
      scenario: "Run devns:run with a ready feature.",
      expected: "Payload includes workerHandoff."
    }
  ],
  unknowns: [],
  risks: [],
  humanDecision: {
    status: "approved"
  }
};

async function runDevns(repoRoot: string, cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("node", [
    "--import",
    path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
    path.join(repoRoot, "packages/core/src/cli/run.ts"),
    ...args
  ], { cwd });
  return JSON.parse(stdout);
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-run-cli-"));
  const originalCwd = process.cwd();
  const repoRoot = originalCwd;

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "Run CLI Smoke",
      projectDescription: "Smoke test workspace"
    });

    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features.push({
      id: "RUN-001",
      title: "Claimable run feature",
      description: "Has approved RFC",
      status: "ready",
      priority: "P1",
      milestone: "Smoke",
      acceptanceCriteria: ["Can be handed off"],
      rfc: approvedRfc
    });
    await writeInventory(cwd, config, inventory);

    const inspected = await runDevns(repoRoot, cwd, "--no-claim", "--json");
    assert.equal(inspected.mode, "claim_next");
    assert.equal(inspected.claimed, false);
    assert.equal(inspected.workerHandoff.strategy, "prefer_isolated_worker");
    assert.equal(inspected.workerHandoff.featureId, "RUN-001");

    const claimed = await runDevns(repoRoot, cwd, "--json");
    assert.equal(claimed.mode, "claim_next");
    assert.equal(claimed.claimed, true);
    assert.deepEqual(claimed.workerHandoff.expectedOutput.slice(0, 2), [
      "changed files and diff summary",
      "commands run and lane evidence"
    ]);

    process.stdout.write("Run CLI smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown run CLI smoke error"}\n`);
  process.exitCode = 1;
});
