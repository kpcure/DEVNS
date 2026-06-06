#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    assert.match(await readFile(path.join(cwd, "AGENTS.md"), "utf8"), /DEVNS Context Index/);

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
    const devnsFilesAfterWrite = await readdir(path.join(cwd, ".devns"));
    assert.equal(devnsFilesAfterWrite.some((file) => file.startsWith(".features.json.tmp-")), false);

    await patchFeature(cwd, config, "SMOKE-001", { status: "in_progress" });
    const updated = await readInventory(cwd, config);
    assert.equal(updated.features[0]?.status, "in_progress");
    assert.ok(updated.revision);

    await patchFeature(cwd, config, "SMOKE-001", {
      artifactRefs: {
        rfc: ".devns/rfcs/SMOKE-001.json",
        evidence: ".devns/evidence/SMOKE-001",
        history: ".devns/history/SMOKE-001.md",
        review: ".devns/reviews/SMOKE-001.md"
      }
    });
    const withArtifactRefs = await readInventory(cwd, config);
    assert.equal(withArtifactRefs.features[0]?.artifactRefs?.rfc, ".devns/rfcs/SMOKE-001.json");

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
    const devnsFilesAfterPatches = await readdir(path.join(cwd, ".devns"));
    assert.equal(devnsFilesAfterPatches.some((file) => file.startsWith(".features.json.tmp-")), false);
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
