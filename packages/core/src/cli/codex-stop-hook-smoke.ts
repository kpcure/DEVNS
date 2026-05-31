#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Feature, FeatureInventory, FeatureRfc, DevnsConfig } from "../harness/types";

async function runHook(cwd: string, input: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bash", ["plugins/codex/devns/scripts/devns-stop-hook.sh"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr || `Hook exited with ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(input);
  });
}

const approvedRfc: FeatureRfc = {
  status: "approved",
  summary: "Smoke RFC",
  background: "Smoke background",
  featureDescription: "Smoke feature",
  expectedOutcome: "Smoke outcome",
  goals: ["Verify stop hook behavior"],
  nonGoals: ["Do not test unrelated hook hosts"],
  requirements: [
    {
      id: "REQ-001",
      type: "explicit",
      statement: "Smoke requirement",
      priority: "must"
    }
  ],
  acceptanceCriteria: [
    {
      id: "AC-001",
      requirementIds: ["REQ-001"],
      statement: "Smoke acceptance",
      verification: "codex stop hook smoke"
    }
  ],
  validationPlan: {
    dynamic: ["npm run codex-stop-hook:smoke --silent"],
    static: []
  },
  testCases: [
    {
      id: "TC-001",
      acceptanceCriteriaIds: ["AC-001"],
      type: "integration",
      scenario: "Run hook",
      expected: "Hook returns expected decision"
    }
  ],
  unknowns: [],
  risks: [],
  humanDecision: {
    status: "approved"
  }
};

function feature(id: string, status: Feature["status"], patch: Partial<Feature> = {}): Feature {
  return {
    id,
    title: `${id} smoke`,
    description: "Smoke feature",
    status,
    priority: "P0",
    milestone: "Smoke",
    acceptanceCriteria: ["Smoke acceptance"],
    verification: ["npm run codex-stop-hook:smoke --silent"],
    evidence: [],
    changedFiles: [],
    reviewDecision: "pending",
    rfc: approvedRfc,
    ...patch
  };
}

async function makeProject(features: Feature[]) {
  const root = process.cwd();
  const tsxBin = path.join(root, "node_modules", ".bin", "tsx");
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-stop-smoke-"));
  await mkdir(path.join(cwd, ".devns"), { recursive: true });
  await mkdir(path.join(cwd, "plugins", "codex", "devns", "scripts"), { recursive: true });
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          "devns:stop": `${tsxBin} ${path.join(root, "packages/core/src/cli/stop-hook.ts")}`
        },
        dependencies: {}
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(cwd, "plugins", "codex", "devns", "scripts", "devns-stop-hook.sh"),
    `#!/usr/bin/env bash\nDEVNS_STOP_COMMAND=\"${tsxBin} ${path.join(root, "packages/core/src/cli/stop-hook.ts")}\" bash ${path.join(root, "plugins/codex/devns/scripts/devns-stop-hook.sh")}\n`
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
          requireCleanWorktree: false,
          requireCommit: true,
          allowEmptyOutputWhenComplete: true
        },
        hooks: {
          stop: {
            mode: "gate",
            blockOn: {
              skippedRequiredVerification: true
            }
          }
        },
        reviewLanes: [
          {
            id: "smoke-lane",
            type: "command",
            command: "npm run smoke",
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
          name: "Stop hook smoke",
          description: "Stop hook smoke project"
        },
        features
      } satisfies FeatureInventory,
      null,
      2
    )
  );
  return cwd;
}

function parseMaybeJson(stdout: string) {
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}

async function main() {
  const activeProject = await makeProject([feature("SMOKE-001", "in_progress")]);
  const claimProject = await makeProject([feature("SMOKE-002", "ready")]);
  const completeProject = await makeProject([
    feature("SMOKE-003", "in_progress", {
      evidence: [
        { type: "verification", summary: "Smoke evidence" },
        { type: "lane:smoke-lane", summary: "Lane smoke-lane passed. Decision: allow." }
      ],
      reviewDecision: "approved",
      commit: "abc123"
    })
  ]);
  const emptyProject = await makeProject([feature("SMOKE-004", "done")]);
  const multiActiveProject = await makeProject([
    feature("SMOKE-005", "in_progress"),
    feature("SMOKE-006", "in_progress")
  ]);

  try {
    const recursive = await runHook(activeProject, JSON.stringify({ cwd: activeProject, stop_hook_active: true }));
    assert.equal(recursive.trim(), "");

    const active = parseMaybeJson(await runHook(activeProject, JSON.stringify({ cwd: activeProject })));
    assert.ok(active, "Active-project hook should block with JSON output.");
    assert.equal(active.decision, "block");
    assert.match(active.reason, /No verification evidence/);
    assert.match(active.reason, /Required lane evidence is missing: smoke-lane/);
    assert.match(active.reason, /No feature commit/);

    const multiActive = parseMaybeJson(await runHook(multiActiveProject, JSON.stringify({ cwd: multiActiveProject })));
    assert.ok(multiActive, "Multi-active hook should block with JSON output.");
    assert.equal(multiActive.decision, "block");
    assert.match(multiActive.reason, /multiple features are in_progress/);

    const claim = parseMaybeJson(await runHook(claimProject, JSON.stringify({ cwd: claimProject })));
    assert.ok(claim, "Claim-project hook should block with JSON output.");
    assert.equal(claim.decision, "block");
    assert.match(claim.reason, /Claimed next feature SMOKE-002/);

    const complete = await runHook(completeProject, JSON.stringify({ cwd: completeProject }));
    assert.equal(complete.trim(), "");

    const empty = await runHook(emptyProject, JSON.stringify({ cwd: emptyProject }));
    assert.equal(empty.trim(), "");
  } finally {
    await Promise.all([activeProject, claimProject, completeProject, emptyProject, multiActiveProject].map((project) => rm(project, { recursive: true, force: true })));
  }

  process.stdout.write("Codex stop hook smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown Codex stop hook smoke error"}\n`);
  process.exitCode = 1;
});
