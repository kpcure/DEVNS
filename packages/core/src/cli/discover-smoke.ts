#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { writeDiscoveredCandidates } from "../harness/discovery";
import { readCandidates, readConfig } from "../harness/state";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-discover-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await writeFile("README.md", "# Fixture\n\nA small product surface.\n");
    await writeFile("package.json", JSON.stringify({ type: "module", scripts: { build: "tsc", test: "node test.js" } }, null, 2));
    await initWorkspace({
      force: false,
      projectName: "Discovery Smoke",
      projectDescription: "Find candidate features from project context."
    });

    const config = await readConfig(cwd);
    const result = await writeDiscoveredCandidates(cwd, config, { force: true });
    const serialized = JSON.stringify(result.candidates);
    assert.ok(result.candidates.length >= 3);
    assert.ok(result.candidates.every((candidate) => candidate.status === "discovered" || candidate.status === "needs_rfc"));
    assert.ok(result.candidates.every((candidate) => candidate.sources !== undefined));
    assert.ok(result.candidates.some((candidate) => candidate.suggestedRisk));
    assert.doesNotMatch(serialized, /librarian|loan|overdue|借阅|逾期|图书/i);

    const inventory = await readCandidates(cwd, config);
    assert.equal(inventory.candidates.length, result.candidates.length);
    assert.match(await readFile(path.join(cwd, ".devns", "candidates.json"), "utf8"), /suggestedRisk/);
    process.stdout.write("Discovery smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown discovery smoke error"}\n`);
  process.exitCode = 1;
});
