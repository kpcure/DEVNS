#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function makeProject(features: Feature[], patch: Partial<DevnsConfig> = {}) {
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
          allowEmptyOutputWhenComplete: true,
          ...(patch.completionPolicy ?? {})
        },
        hooks: {
          stop: {
            mode: "gate",
            blockOn: {
              skippedRequiredVerification: true
            },
            ...(patch.hooks?.stop ?? {})
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

async function readStopLog(cwd: string) {
  const raw = await readFile(path.join(cwd, ".devns", "history", "stop-hook.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          source?: string;
          phase?: string;
          mode?: string;
          decision?: string;
          selectedFeatureId?: string;
          reasons?: string[];
          laneIds?: string[];
        }
    );
}

async function installReviewAgentLane(cwd: string) {
  const configPath = path.join(cwd, ".devns", "devns.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as DevnsConfig;
  config.reviewLanes = [
    ...(config.reviewLanes ?? []),
    {
      id: "code-review",
      type: "agent",
      command: "node review-agent.mjs",
      required: true,
      blocksCompletion: true
    }
  ];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(
    path.join(cwd, "review-agent.mjs"),
    [
      "const result = {",
      "  lane: 'code-review',",
      "  type: 'agent',",
      "  status: 'pass',",
      "  decision: 'allow',",
      "  summary: 'Review Agent smoke pass.',",
      "  confidence: 'high',",
      "  findings: [],",
      "  evidence: [{ type: 'review-context', summary: `Reviewed ${process.env.DEVNS_REVIEW_PROMPT || 'prompt'}.` }],",
      "  artifacts: process.env.DEVNS_REVIEW_PACKET ? [process.env.DEVNS_REVIEW_PACKET] : [],",
      "  recommendedActions: [],",
      "  blocksCompletion: false,",
      "  required: true",
      "};",
      "process.stdout.write(JSON.stringify(result));"
    ].join("\n")
  );
}

async function readFeature(cwd: string, featureId: string) {
  const inventory = JSON.parse(await readFile(path.join(cwd, ".devns", "features.json"), "utf8")) as FeatureInventory;
  const found = inventory.features.find((item) => item.id === featureId);
  assert.ok(found, `Feature ${featureId} should exist.`);
  return found;
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
  const reviewAgentProject = await makeProject([feature("SMOKE-007", "in_progress")]);
  await installReviewAgentLane(reviewAgentProject);
  const contextBudgetProject = await makeProject(
    [feature("SMOKE-008", "in_progress")],
    {
      completionPolicy: {
        contextBudget: {
          preferFreshWorkerPerFeature: true,
          maxContinuationTurns: 1,
          handoffTokenBudget: 900,
          resetWhenHistoryRecordsExceed: 1
        }
      }
    }
  );
  await mkdir(path.join(contextBudgetProject, ".devns", "history"), { recursive: true });
  await writeFile(
    path.join(contextBudgetProject, ".devns", "history", "SMOKE-008.jsonl"),
    [
      JSON.stringify({ id: "SMOKE-008-1", featureId: "SMOKE-008", decisions: ["first attempt"], lessons: [] }),
      JSON.stringify({ id: "SMOKE-008-2", featureId: "SMOKE-008", decisions: ["second attempt"], lessons: [] })
    ].join("\n") + "\n"
  );

  try {
    const recursive = await runHook(activeProject, JSON.stringify({ cwd: activeProject, stop_hook_active: true }));
    assert.equal(recursive.trim(), "");

    const active = parseMaybeJson(await runHook(activeProject, JSON.stringify({ cwd: activeProject })));
    assert.ok(active, "Active-project hook should block with JSON output.");
    assert.equal(active.decision, "block");
    assert.match(active.reason, /No verification evidence/);
    assert.match(active.reason, /Required lane evidence is missing: smoke-lane/);
    assert.match(active.reason, /No feature commit/);
    const activeLog = await readStopLog(activeProject);
    assert.ok(activeLog.some((entry) => entry.source === "adapter" && entry.phase === "start"));
    assert.ok(activeLog.some((entry) => entry.source === "adapter" && entry.phase === "exec"));
    assert.ok(
      activeLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.mode === "active_block" &&
          entry.decision === "block" &&
          entry.selectedFeatureId === "SMOKE-001" &&
          (entry.reasons ?? []).some((reason) => /No verification evidence/.test(reason))
      )
    );

    const multiActive = parseMaybeJson(await runHook(multiActiveProject, JSON.stringify({ cwd: multiActiveProject })));
    assert.ok(multiActive, "Multi-active hook should block with JSON output.");
    assert.equal(multiActive.decision, "block");
    assert.match(multiActive.reason, /multiple features are in_progress/);

    const claim = parseMaybeJson(await runHook(claimProject, JSON.stringify({ cwd: claimProject })));
    assert.ok(claim, "Claim-project hook should block with JSON output.");
    assert.equal(claim.decision, "block");
    assert.match(claim.reason, /Claimed next feature SMOKE-002/);
    assert.match(claim.reason, /Start a Sub Agent, isolated worker, or fresh implementation context/);
    assert.match(claim.reason, /Feature context:/);
    assert.match(claim.reason, /Validation context:/);
    assert.match(claim.reason, /Semantic agent lane configured: no/);
    assert.match(claim.reason, /"strategy":"prefer_isolated_worker"/);
    assert.match(claim.reason, /"featureId":"SMOKE-002"/);
    assert.match(claim.reason, /"rfcContext"/);
    assert.match(claim.reason, /"validationContext"/);
    const claimLog = await readStopLog(claimProject);
    assert.ok(
      claimLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.mode === "claim_next_block" &&
          entry.decision === "block" &&
          entry.selectedFeatureId === "SMOKE-002"
      )
    );

    const secondClaimStop = parseMaybeJson(await runHook(claimProject, JSON.stringify({ cwd: claimProject })));
    assert.ok(secondClaimStop, "Second hook after claim should block the active feature loop.");
    assert.equal(secondClaimStop.decision, "block");
    assert.match(secondClaimStop.reason, /Continue feature SMOKE-002/);
    assert.match(secondClaimStop.reason, /No verification evidence/);
    const secondClaimLog = await readStopLog(claimProject);
    assert.ok(
      secondClaimLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.mode === "active_block" &&
          entry.decision === "block" &&
          entry.selectedFeatureId === "SMOKE-002"
      )
    );

    const reviewAgent = parseMaybeJson(await runHook(reviewAgentProject, JSON.stringify({ cwd: reviewAgentProject })));
    assert.ok(reviewAgent, "Review-agent project hook should block after recording agent evidence.");
    assert.equal(reviewAgent.decision, "block");
    assert.match(reviewAgent.reason, /Continue feature SMOKE-007/);
    assert.doesNotMatch(reviewAgent.reason, /Required lane evidence is missing: code-review/);
    assert.doesNotMatch(reviewAgent.reason, /Review decision is still pending/);
    assert.match(reviewAgent.reason, /Required lane evidence is missing: smoke-lane/);
    const reviewedFeature = await readFeature(reviewAgentProject, "SMOKE-007");
    assert.equal(reviewedFeature.reviewDecision, "approved");
    assert.ok((reviewedFeature.evidence ?? []).some((item) => item.type === "lane:code-review" && item.actor === "review-agent:code-review"));
    assert.ok(reviewedFeature.history?.historyPath, "Review-agent hook should write execution history.");
    const reviewAgentLog = await readStopLog(reviewAgentProject);
    assert.ok(
      reviewAgentLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.phase === "review_agent" &&
          entry.mode === "run_missing" &&
          entry.selectedFeatureId === "SMOKE-007" &&
          (entry.laneIds ?? []).includes("code-review")
      )
    );

    const contextBudget = parseMaybeJson(await runHook(contextBudgetProject, JSON.stringify({ cwd: contextBudgetProject })));
    assert.ok(contextBudget, "Context-budget project hook should block with JSON output.");
    assert.equal(contextBudget.decision, "block");
    assert.match(contextBudget.reason, /Context budget:/);
    assert.match(contextBudget.reason, /fresh worker or compact implementation context/);
    assert.match(contextBudget.reason, /exceeding resetWhenHistoryRecordsExceed=1/);
    assert.match(contextBudget.reason, /900 token/);
    assert.ok(
      reviewAgentLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.phase === "review_agent" &&
          entry.mode === "review_agent_allow" &&
          entry.selectedFeatureId === "SMOKE-007"
      )
    );

    const complete = await runHook(completeProject, JSON.stringify({ cwd: completeProject }));
    assert.equal(complete.trim(), "");
    const completeLog = await readStopLog(completeProject);
    assert.ok(
      completeLog.some(
        (entry) =>
          entry.source === "core" &&
          entry.mode === "active_allow_complete" &&
          entry.decision === "allow" &&
          entry.selectedFeatureId === "SMOKE-003"
      )
    );

    const empty = await runHook(emptyProject, JSON.stringify({ cwd: emptyProject }));
    assert.equal(empty.trim(), "");
    const emptyLog = await readStopLog(emptyProject);
    assert.ok(emptyLog.some((entry) => entry.source === "core" && entry.mode === "empty_allow" && entry.decision === "allow"));
  } finally {
    await Promise.all(
      [activeProject, claimProject, completeProject, emptyProject, multiActiveProject, reviewAgentProject, contextBudgetProject].map((project) =>
        rm(project, { recursive: true, force: true })
      )
    );
  }

  process.stdout.write("Codex stop hook smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown Codex stop hook smoke error"}\n`);
  process.exitCode = 1;
});
