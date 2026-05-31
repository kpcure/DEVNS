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
  summary: "Approved CLI smoke RFC",
  background: "Smoke test background",
  featureDescription: "Smoke test feature",
  expectedOutcome: "Feature can be claimed through CLI",
  goals: ["Verify CLI claim"],
  nonGoals: ["Do not exercise unrelated queue behavior."],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "Queue CLI should claim a ready feature with an approved RFC.",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "CLI claim returns the claimed feature."
    }
  ],
  validationPlan: {
    dynamic: ["Run queue smoke."],
    static: ["Inspect command output."]
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "unit",
      scenario: "Run queue claim.",
      expected: "Feature becomes in_progress."
    }
  ],
  unknowns: [],
  risks: [],
  humanDecision: {
    status: "approved"
  }
};

async function runQueue(repoRoot: string, cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("node", [
    "--import",
    path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
    path.join(repoRoot, "packages/core/src/cli/queue.ts"),
    ...args
  ], { cwd });
  return stdout;
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-queue-cli-"));
  const originalCwd = process.cwd();
  const repoRoot = originalCwd;

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "Queue CLI Smoke",
      projectDescription: "Smoke test workspace"
    });

    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features.push(
      {
        id: "CLI-001",
        title: "Claimable CLI feature",
        description: "Has approved RFC",
        status: "ready",
        priority: "P1",
        milestone: "Smoke",
        acceptanceCriteria: ["Can be claimed"],
        rfc: approvedRfc
      },
      {
        id: "CLI-002",
        title: "Blocked CLI feature",
        description: "Missing RFC",
        status: "ready",
        priority: "P0",
        milestone: "Smoke",
        acceptanceCriteria: ["Cannot be claimed"]
      }
    );
    await writeInventory(cwd, config, inventory);

    const status = JSON.parse(await runQueue(repoRoot, cwd, "status", "--json"));
    assert.equal(status.summary.total, 2);
    assert.equal(status.summary.claimable, 1);

    const next = JSON.parse(await runQueue(repoRoot, cwd, "next", "--json"));
    assert.equal(next.feature.id, "CLI-001");

    const claimed = JSON.parse(await runQueue(repoRoot, cwd, "claim", "--json"));
    assert.equal(claimed.feature.id, "CLI-001");
    assert.equal(claimed.feature.status, "in_progress");

    process.stdout.write("Queue CLI smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown queue CLI smoke error"}\n`);
  process.exitCode = 1;
});
