#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { main as initWorkspace } from "./init";
import { appendExecutionHistory } from "../harness/history";
import { writeReviewPacket } from "../harness/review-packet";
import { readConfig, readInventory, writeInventory } from "../harness/state";
import type { Feature } from "../harness/types";

const execFileAsync = promisify(execFile);

async function writeBrowserSmokeArtifact(cwd: string) {
  const artifactDir = path.join(cwd, ".devns", "artifacts", "browser-smoke", "PKT-001");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        type: "browser_smoke",
        command: "npx playwright test",
        exitCode: 0,
        artifactDir: ".devns/artifacts/browser-smoke/PKT-001",
        stdout: ".devns/artifacts/browser-smoke/PKT-001/stdout.log",
        stderr: ".devns/artifacts/browser-smoke/PKT-001/stderr.log",
        artifacts: [
          { kind: "console", path: ".devns/artifacts/browser-smoke/PKT-001/console.ndjson" },
          { kind: "network", path: ".devns/artifacts/browser-smoke/PKT-001/network.ndjson" }
        ]
      },
      null,
      2
    )}\n`
  );
  await writeFile(path.join(artifactDir, "stdout.log"), "browser ok\n");
  await writeFile(path.join(artifactDir, "stderr.log"), "");
  await writeFile(path.join(artifactDir, "console.ndjson"), '{"type":"log","text":"ready"}\n');
  await writeFile(path.join(artifactDir, "network.ndjson"), '{"url":"http://127.0.0.1/api","status":200}\n');
}

function doneFeature(): Feature {
  return {
    id: "PKT-001",
    title: "Review packet smoke",
    description: "Verify review packets include review context.",
    status: "done",
    priority: "P1",
    milestone: "Smoke",
    risk: "high",
    acceptanceCriteria: ["Packet includes diff and evidence quality"],
    evidence: [
      { type: "lane:test", summary: "Packet smoke passed." },
      {
        type: "browser",
        summary: "Browser smoke captured inspectable artifacts.",
        verificationType: "browser_smoke",
        artifactRefs: [".devns/artifacts/browser-smoke/PKT-001/run.json"]
      },
      { type: "git", summary: "Implementation commit recorded." }
    ],
    changedFiles: ["src/review.ts"],
    commit: "HEAD",
    implementationCommit: "HEAD",
    reviewDecision: "approved",
    agentNotes: "Review packet smoke notes",
    rfc: {
      status: "approved",
      summary: "Packet builder provides review agent input.",
      background: "Review agents need bounded context.",
      featureDescription: "Build a deterministic review packet.",
      expectedOutcome: "Packet contains RFC, evidence, diff, and rules.",
      goals: ["Bounded review context"],
      nonGoals: ["Do not run an LLM review in the packet builder."],
      requirements: [{ id: "REQ-001", type: "explicit", statement: "Provide review context", priority: "must" }],
      acceptanceCriteria: [{ id: "AC-001", requirementIds: ["REQ-001"], statement: "Packet includes diff and evidence quality" }],
      validationPlan: { dynamic: ["packet smoke"], static: [] },
      testCases: [{ id: "TC-001", acceptanceCriteriaIds: ["AC-001"], type: "integration", scenario: "Write packet", expected: "Packet file exists" }],
      humanDecision: { status: "approved" }
    }
  };
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-review-packet-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(cwd);
    await initWorkspace({ force: false, projectName: "Review Packet Smoke", projectDescription: "Smoke" });
    const config = await readConfig(cwd);
    const inventory = await readInventory(cwd, config);
    inventory.features = [doneFeature()];
    await writeInventory(cwd, config, inventory);
    await writeFile(path.join(cwd, "AGENTS.md"), "# Agent rules\n\nStay read-only during review.\n");

    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["config", "user.email", "devns@example.invalid"], { cwd });
    await execFileAsync("git", ["config", "user.name", "DEVNS Smoke"], { cwd });
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "review.ts"), "export const reviewed = true;\n");
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["commit", "-m", "Implement review packet smoke"], { cwd });
    const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    const committed = await readInventory(cwd, config);
    committed.features[0].commit = head;
    committed.features[0].implementationCommit = head;
    await writeInventory(cwd, config, committed);
    await writeBrowserSmokeArtifact(cwd);

    await appendExecutionHistory(cwd, config, {
      featureId: "PKT-001",
      actor: "agent",
      summary: "Implemented packet smoke.",
      decisions: ["Use bounded packets for review agents."],
      alternativesRejected: [],
      changedFiles: [],
      impact: ["Review agent input is deterministic."],
      pitfalls: [],
      errors: [],
      fixes: [],
      lessons: ["Keep packet generation read-only."],
      risks: [],
      dynamicChecks: [],
      staticChecks: []
    });

    const result = await writeReviewPacket(cwd, { featureId: "PKT-001", format: "prompt", write: true, commit: head });
    assert.equal(result.packet.feature.id, "PKT-001");
    assert.equal(result.packet.evidenceQuality.decision, "allow");
    assert.equal(result.packet.artifactDigests[0]?.browserSmoke?.networkRequests, 1);
    assert.match(result.packet.git.diff, /reviewed/);
    const prompt = await readFile(path.join(cwd, result.promptPath), "utf8");
    assert.match(prompt, /DEVNS Review Agent Packet/);
    assert.match(prompt, /Artifact Digests/);
    assert.match(prompt, /networkRequests/);

    process.stdout.write("Review packet smoke passed.\n");
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown review packet smoke error"}\n`);
  process.exitCode = 1;
});
