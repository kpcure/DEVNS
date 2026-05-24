#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { main as initWorkspace } from "./init";
import { computeRevision, patchFeature, readConfig, readInventory, writeInventory } from "../harness/state";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-feature-store-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({
      force: false,
      projectName: "Feature Store Smoke",
      projectDescription: "Smoke test workspace"
    });

    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features.push({
      id: "SMOKE-001",
      title: "Smoke feature",
      description: "Verify patchFeature",
      status: "ready",
      priority: "P1",
      milestone: "Smoke",
      acceptanceCriteria: ["Can patch allowed fields"]
    });
    await writeInventory(cwd, config, inventory);

    await patchFeature(cwd, config, "SMOKE-001", { status: "in_progress" });
    const updated = await readInventory(cwd, config);
    assert.equal(updated.features[0]?.status, "in_progress");
    assert.ok(updated.revision);

    await assert.rejects(
      () =>
        patchFeature(
          cwd,
          config,
          "SMOKE-001",
          { title: "not allowed" } as Parameters<typeof patchFeature>[3]
        ),
      /not editable/
    );

    await assert.rejects(
      () => patchFeature(cwd, config, "SMOKE-001", { status: "done" }, { expectedRevision: "stale" }),
      /revision conflict/
    );

    const currentRevision = computeRevision(updated);
    assert.equal(updated.revision, currentRevision);
    process.stdout.write("Feature Store smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown feature store smoke error"}\n`);
  process.exitCode = 1;
});
