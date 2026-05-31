#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { runHarnessValidation } from "../harness/validate";
import { readConfig, readInventory, writeInventory } from "../harness/state";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-validate-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "Validate Smoke",
      projectDescription: "Smoke test workspace"
    });

    const baseline = await runHarnessValidation(cwd);
    assert.equal(baseline.summary.fail, 0);
    assert.notEqual(baseline.status, "fail");

    const strictBaseline = await runHarnessValidation(cwd, { strict: true });
    assert.equal(strictBaseline.status, "fail");

    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features.push(
      {
        id: "DUP-001",
        title: "Duplicate A",
        description: "Smoke duplicate",
        status: "blocked",
        priority: "P2",
        milestone: "Smoke",
        acceptanceCriteria: ["Exists"]
      },
      {
        id: "DUP-001",
        title: "Duplicate B",
        description: "Smoke duplicate",
        status: "blocked",
        priority: "P2",
        milestone: "Smoke",
        acceptanceCriteria: ["Exists"]
      }
    );
    await writeInventory(cwd, config, inventory);

    const duplicate = await runHarnessValidation(cwd);
    assert.equal(duplicate.status, "fail");
    assert.ok(duplicate.checks.some((check) => check.id === "state.feature_ids_unique" && check.status === "fail"));

    process.stdout.write("Harness validation smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown harness validation smoke error"}\n`);
  process.exitCode = 1;
});
