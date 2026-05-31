#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initWorkspace } from "./init";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { Feature } from "../harness/types";

const execFileAsync = promisify(execFile);

function feature(): Feature {
  return {
    id: "EVD-001",
    title: "Evidence smoke",
    description: "Verify evidence CLI writes review evidence.",
    status: "in_progress",
    priority: "P0",
    milestone: "Smoke",
    acceptanceCriteria: ["Review evidence can be recorded"],
    evidence: [],
    rfc: {
      status: "approved",
      summary: "Record evidence.",
      background: "Hand-editing JSON is brittle.",
      featureDescription: "Add evidence through CLI.",
      expectedOutcome: "Feature evidence includes browser evidence.",
      goals: ["Evidence CLI"],
      nonGoals: [],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Record review evidence", priority: "must" }],
      acceptanceCriteria: [
        { id: "AC-001", requirementIds: ["REQ-001"], statement: "Review evidence can be recorded", verificationType: "browser_smoke" }
      ],
      validationPlan: { dynamic: [], static: [] },
      testCases: [],
      humanDecision: { status: "approved" }
    }
  };
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-evidence-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({ force: false, projectName: "Evidence Smoke", projectDescription: "Smoke" });
    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features = [feature()];
    await writeInventory(cwd, config, inventory);

    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const evidenceCli = path.join(repoRoot, "packages", "core", "src", "cli", "evidence.ts");
    const lanesCli = path.join(repoRoot, "packages", "core", "src", "cli", "lanes.ts");
    await execFileAsync(
      tsx,
      [
        evidenceCli,
        "add",
        "--feature",
        "EVD-001",
        "--type",
        "browser",
        "--summary",
        "Observed workflow labels.",
        "--verification",
        "browser_smoke",
        "--covers-ac",
        "AC-001",
        "--actor",
        "human"
      ],
      { cwd }
    );

    const updated = JSON.parse(await readFile(path.join(cwd, ".devns", "features.json"), "utf8"));
    assert.equal(updated.features[0].evidence[0].verificationType, "browser_smoke");
    assert.equal(updated.features[0].evidence[0].actor, "human");
    assert.deepEqual(updated.features[0].evidence[0].coversAcceptanceCriteriaIds, ["AC-001"]);

    const resultPath = path.join(cwd, "lane-result.json");
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          lane: "code-review",
          type: "agent",
          status: "pass",
          decision: "allow",
          summary: "Read-only review found no blocking issue.",
          confidence: "high",
          findings: [],
          evidence: [{ type: "review-context", summary: "Reviewed RFC and diff." }],
          artifacts: [],
          recommendedActions: [],
          blocksCompletion: false,
          required: true
        },
        null,
        2
      )
    );
    await execFileAsync(tsx, [lanesCli, "ingest", "--feature", "EVD-001", "--result", resultPath, "--actor", "review-agent:smoke"], { cwd });
    const ingested = JSON.parse(await readFile(path.join(cwd, ".devns", "features.json"), "utf8"));
    assert.ok(ingested.features[0].evidence.some((item: { type: string; actor: string }) => item.type === "lane:code-review" && item.actor === "review-agent:smoke"));

    process.stdout.write("Evidence CLI smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown evidence smoke error"}\n`);
  process.exitCode = 1;
});
