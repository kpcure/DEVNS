#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Feature, FeatureInventory, FeatureRfc, DevnsConfig } from "../harness/types";
import type { OrchestratorTraceRecord } from "../harness/orchestrator-trace";

const execFileAsync = promisify(execFile);

async function runDevns(repoRoot: string, cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
    path.join(repoRoot, "packages/core/src/cli/devns.ts"),
    ...args
  ], { cwd });
  return stdout;
}

const approvedRfc: FeatureRfc = {
  status: "approved",
  summary: "Build an orchestrated worker loop",
  background: "Smoke background",
  featureDescription: "Feature worker should receive a bounded handoff.",
  expectedOutcome: "Main agent can delegate implementation and review.",
  goals: ["Delegate implementation"],
  nonGoals: ["Do not use Stop Hook as the primary loop"],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "The orchestrator must provide implementation and review subagent prompts.",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "The packet names a worker and reviewer.",
      verification: "orchestrate smoke"
    }
  ],
  validationPlan: {
    dynamic: ["npm run orchestrate:smoke --silent"],
    static: []
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "integration",
      scenario: "Run orchestrator",
      expected: "The packet names a worker and reviewer."
    }
  ],
  unknowns: [],
  risks: [],
  humanDecision: {
    status: "approved"
  }
};

function feature(id: string, status: Feature["status"]): Feature {
  return {
    id,
    title: `${id} orchestrated feature`,
    description: "Smoke feature",
    status,
    priority: "P0",
    milestone: "Smoke",
    acceptanceCriteria: ["The packet names a worker and reviewer."],
    evidence: [],
    changedFiles: [],
    reviewDecision: "pending",
    rfc: approvedRfc
  };
}

async function makeProject(features: Feature[]) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-orchestrate-"));
  await mkdir(path.join(cwd, ".devns"), { recursive: true });
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({ type: "module", scripts: {} }, null, 2)
  );
  await writeFile(
    path.join(cwd, ".devns", "devns.config.json"),
    JSON.stringify(
      {
        version: 1,
        features: ".devns/features.json",
        completionPolicy: {
          mode: "queue",
          whenNoActiveFeature: "claim_next",
          whenNoClaimableFeature: "allow_stop",
          requireApprovedRfc: true,
          requireEvidence: true,
          requireReviewDecision: true,
          requireCommit: true
        },
        reviewLanes: [
          {
            id: "code-review",
            type: "agent",
            agent: "devns-code-reviewer",
            command: "node review-agent.mjs",
            required: true,
            blocksCompletion: true
          }
        ]
      } satisfies DevnsConfig,
      null,
      2
    )
  );
  await writeFile(
    path.join(cwd, ".devns", "features.json"),
    JSON.stringify(
      {
        project: {
          name: "Orchestrate smoke",
          description: "Orchestrate smoke project"
        },
        features
      } satisfies FeatureInventory,
      null,
      2
    )
  );
  return cwd;
}

async function readTraceRecords(cwd: string) {
  const raw = await readFile(path.join(cwd, ".devns", "traces", "orchestrator.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OrchestratorTraceRecord);
}

async function main() {
  const repoRoot = process.cwd();
  const claimProject = await makeProject([feature("ORCH-001", "ready")]);
  const activeProject = await makeProject([feature("ORCH-002", "in_progress")]);
  const emptyProject = await makeProject([feature("ORCH-003", "done")]);

  try {
    const claim = JSON.parse(await runDevns(repoRoot, claimProject, "orchestrate", "--host", "codex", "--json"));
    assert.equal(claim.mode, "claim_next");
    assert.equal(claim.claimed, true);
    assert.equal(claim.featureId, "ORCH-001");
    assert.equal(claim.stopHookRole, "safety_net_only");
    assert.equal(claim.implementationSubagent.name, "devns_feature_worker");
    assert.match(claim.implementationSubagent.launchInstruction, /Explicitly spawn/);
    assert.match(claim.implementationSubagent.prompt, /Worker handoff JSON/);
    assert.equal(claim.reviewSubagent.name, "devns_code_reviewer");
    assert.match(claim.reviewSubagent.prompt, /lane-result JSON/);
    assert.equal(claim.trace.path, ".devns/traces/orchestrator.jsonl");
    assert.equal(typeof claim.trace.traceId, "string");

    const claimInventory = JSON.parse(await readFile(path.join(claimProject, ".devns", "features.json"), "utf8")) as FeatureInventory;
    assert.equal(claimInventory.features[0]?.status, "in_progress");
    const claimTrace = await readTraceRecords(claimProject);
    assert.equal(claimTrace.length, 1);
    assert.equal(claimTrace[0]?.mode, "claim_next");
    assert.equal(claimTrace[0]?.featureId, "ORCH-001");
    assert.equal(claimTrace[0]?.claimed, true);
    assert.equal(claimTrace[0]?.subagents.implementation, "devns_feature_worker");
    assert.equal(claimTrace[0]?.subagents.review, "devns_code_reviewer");
    assert.deepEqual(Object.keys(claimTrace[0] ?? {}).includes("prompt"), false);

    const active = JSON.parse(await runDevns(repoRoot, activeProject, "orchestrate", "--host", "claude", "--json"));
    assert.equal(active.mode, "continue_active");
    assert.equal(active.claimed, false);
    assert.equal(active.implementationSubagent.name, "devns-feature-worker");
    assert.match(active.implementationSubagent.launchInstruction, /Use the devns-feature-worker subagent/);
    assert.equal(active.reviewSubagent.name, "devns-code-reviewer");
    const activeTrace = await readTraceRecords(activeProject);
    assert.equal(activeTrace[0]?.mode, "continue_active");
    assert.equal(activeTrace[0]?.featureId, "ORCH-002");

    const empty = JSON.parse(await runDevns(repoRoot, emptyProject, "orchestrate", "--json"));
    assert.equal(empty.mode, "empty_queue");
    assert.match(empty.reasons.join(" "), /safe for the orchestrator to stop/);
    const emptyTrace = await readTraceRecords(emptyProject);
    assert.equal(emptyTrace[0]?.mode, "empty_queue");
    assert.equal(emptyTrace[0]?.featureId, undefined);

    process.stdout.write("Orchestrate smoke passed.\n");
  } finally {
    await Promise.all([claimProject, activeProject, emptyProject].map((project) => rm(project, { recursive: true, force: true })));
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown orchestrate smoke error"}\n`);
  process.exitCode = 1;
});
