#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initWorkspace } from "./init";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { Feature } from "../harness/types";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function completeFeature(): Feature {
  return {
    id: "COMP-001",
    title: "Complete command smoke",
    description: "Verify devns complete records implementation metadata.",
    status: "in_progress",
    priority: "P0",
    milestone: "Smoke",
    risk: "medium",
    acceptanceCriteria: ["Completion records implementation commit"],
    verification: ["npm run complete:smoke"],
    evidence: [
      { type: "lane:test", summary: "Completion smoke verification passed.", coversAcceptanceCriteriaIds: ["AC-001"], verificationType: "command" },
      { type: "lane:review-agent", summary: "Read-only review found no blocking issues.", coversAcceptanceCriteriaIds: ["AC-001"], verificationType: "review_agent" }
    ],
    changedFiles: ["src/feature.ts"],
    agentNotes: "Smoke completion notes",
    rfc: {
      status: "approved",
      summary: "Complete command records feature completion.",
      background: "Manual metadata edits are error-prone.",
      featureDescription: "Use a CLI command to mark a feature complete.",
      expectedOutcome: "Feature is done with implementationCommit set.",
      goals: ["Record completion"],
      nonGoals: ["Do not create a git commit inside the smoke test command."],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Record implementation commit", priority: "must" }],
      acceptanceCriteria: [{ id: "AC-001", requirementIds: ["REQ-001"], statement: "Completion records implementation commit", verificationType: "command" }],
      validationPlan: { dynamic: ["complete smoke"], static: ["schema validation"] },
      testCases: [{ id: "TC-001", acceptanceCriteriaIds: ["AC-001"], type: "integration", scenario: "Run complete", expected: "Feature done" }],
      humanDecision: { status: "approved" }
    }
  };
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-complete-"));
  const repoRoot = process.cwd();
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({ force: false, projectName: "Complete Smoke", projectDescription: "Smoke" });
    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features = [completeFeature()];
    await writeInventory(cwd, config, inventory);

    await execFileAsync("git", ["init"], { cwd });
    await git(cwd, ["config", "user.email", "devns@example.invalid"]);
    await git(cwd, ["config", "user.name", "DEVNS Smoke"]);
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "feature.ts"), "export const value = 1;\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Implement smoke feature"]);
    const head = await git(cwd, ["rev-parse", "HEAD"]);

    const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const cli = path.join(repoRoot, "packages", "core", "src", "cli", "complete.ts");
    const { stdout } = await execFileAsync(tsx, [cli, "--id", "COMP-001", "--json"], { cwd });
    const payload = JSON.parse(stdout);
    assert.equal(payload.implementationCommit, head);

    const updated = JSON.parse(await readFile(path.join(cwd, ".devns", "features.json"), "utf8"));
    assert.equal(updated.features[0].status, "done");
    assert.equal(updated.features[0].implementationCommit, head);
    assert.ok(updated.features[0].evidence.some((item: { type: string }) => item.type === "git"));

    process.stdout.write("Complete command smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown complete smoke error"}\n`);
  process.exitCode = 1;
});
