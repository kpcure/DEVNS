#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initWorkspace } from "./init";
import { appendExecutionHistory } from "../harness/history";
import { writeMorningReviewReport } from "../harness/morning-review";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { Feature } from "../harness/types";

const execFileAsync = promisify(execFile);

function doneFeature(id: string, changedFiles: string[], commit?: string): Feature {
  return {
    id,
    title: `${id} feature`,
    description: "Fixture feature",
    status: "done",
    priority: "P1",
    milestone: "Smoke",
    risk: id.endsWith("2") ? "high" : "medium",
    acceptanceCriteria: ["Criterion has evidence"],
    verification: ["fixture"],
    evidence: [
      {
        type: "lane:browser-smoke",
        summary: "Browser smoke passed. Decision: allow.",
        verificationType: "browser_smoke",
        coversAcceptanceCriteriaIds: ["AC-001"],
        artifactRefs: [`.devns/artifacts/browser-smoke/${id}/run.json`]
      },
      { type: "git", summary: `Committed ${changedFiles.length} file(s).` }
    ],
    artifactRefs: {
      evidence: `.devns/evidence/${id}.json`
    },
    changedFiles,
    commit: commit ?? `${id.toLowerCase()}abc`,
    implementationCommit: commit,
    reviewDecision: "approved",
    rfc: {
      status: "approved",
      summary: `${id} RFC intent`,
      background: "Fixture background",
      featureDescription: "Fixture description",
      expectedOutcome: "Fixture outcome",
      goals: ["Grouped review"],
      nonGoals: [],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Need report", priority: "must" }],
      acceptanceCriteria: [{ id: "AC-001", statement: "Criterion has evidence" }],
      validationPlan: { dynamic: ["fixture"], static: [] },
      testCases: [{ id: "TC-001", type: "unit", scenario: "Generate", expected: "Report exists" }],
      humanDecision: { status: "approved" }
    }
  };
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-morning-review-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({ force: false, projectName: "Morning Review Smoke", projectDescription: "Smoke" });
    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "devns@example.invalid"], { cwd });
    await execFileAsync("git", ["config", "user.name", "DEVNS Smoke"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["commit", "-m", "Initialize DEVNS smoke workspace"], { cwd });
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "shared.ts"), "export const shared = true;\n");
    await writeFile(path.join(cwd, "src", "a.ts"), "export const a = true;\n");
    await writeFile(path.join(cwd, "src", "b.ts"), "export const b = true;\n");
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["commit", "-m", "REV-001: implement morning review smoke"], { cwd });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();

    inventory.features = [
      doneFeature("REV-001", ["src/shared.ts", "src/a.ts"], head),
      doneFeature("REV-002", ["src/shared.ts", "src/b.ts"], head)
    ];
    await writeInventory(cwd, config, inventory);

    await appendExecutionHistory(cwd, config, {
      featureId: "REV-001",
      actor: "agent",
      summary: "Implemented REV-001.",
      decisions: ["Use feature packets instead of commit-only review."],
      alternativesRejected: [],
      changedFiles: [],
      impact: ["Morning review can summarize a feature."],
      pitfalls: [{ summary: "Commit-only review hides feature intent." }],
      errors: [],
      fixes: ["Group evidence under the feature id."],
      lessons: ["Read RFC intent before inspecting diffs."],
      risks: [],
      dynamicChecks: [],
      staticChecks: []
    });

    const result = await writeMorningReviewReport(cwd, "2026-05-30");
    assert.equal(result.report.summary.featureCount, 2);
    assert.equal(result.report.crossFeatureRisks[0], "src/shared.ts changed by REV-002, REV-001");
    const rev001 = result.report.packets.find((packet) => packet.featureId === "REV-001");
    assert.match(rev001?.lessons[0] ?? "", /RFC intent/);
    assert.match(rev001?.diff?.patch ?? "", /shared/);
    assert.ok((rev001?.diff?.filesChanged ?? 0) > 0);
    assert.ok(rev001?.artifactRefs.includes(".devns/artifacts/browser-smoke/REV-001/run.json"));
    assert.ok(rev001?.artifactRefs.includes(".devns/evidence/REV-001.json"));

    const configless = await readInventory(cwd, config);
    delete configless.features[0].commit;
    delete configless.features[0].implementationCommit;
    await writeInventory(cwd, config, configless);
    const inferred = await writeMorningReviewReport(cwd, "2026-05-31");
    const inferredPacket = inferred.report.packets.find((packet) => packet.featureId === "REV-001");
    assert.match(inferredPacket?.diff?.patch ?? "", /shared/);

    const json = JSON.parse(await readFile(path.join(cwd, result.jsonPath), "utf8"));
    assert.equal(json.packets.length, 2);
    const markdown = await readFile(path.join(cwd, result.markdownPath), "utf8");
    assert.match(markdown, /Morning Review 2026-05-30/);
    assert.match(markdown, /\.devns\/artifacts\/browser-smoke\/REV-001\/run\.json/);

    process.stdout.write("Morning review smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown morning review smoke error"}\n`);
  process.exitCode = 1;
});
