#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main as initWorkspace } from "./init";
import { runHarnessValidation } from "../harness/validate";
import { readConfig, readInventory, writeInventory, writeJsonFile } from "../harness/state";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-validate-"));
  const originalCwd = process.cwd();

  try {
    const bootstrap = await runHarnessValidation(cwd);
    assert.equal(bootstrap.status, "fail");
    assert.ok(bootstrap.checks.some((check) => check.id === "workspace.bootstrap" && check.status === "fail"));

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
    await writeJsonFile(path.join(cwd, ".devns", "devns.config.json"), {
      ...config,
      artifactIntegrity: {
        browserSmoke: {
          requireRichBrowserArtifacts: true,
          networkBlockedUrls: ["https://analytics.example.com/*"]
        }
      }
    });
    const policyConfig = await readConfig(cwd);
    await mkdir(path.join(cwd, ".devns", "artifacts", "browser-smoke", "policy"), { recursive: true });
    await writeJsonFile(path.join(cwd, ".devns", "artifacts", "browser-smoke", "policy", "run.json"), {
      schemaVersion: 1,
      type: "browser_smoke",
      command: "npx playwright test",
      exitCode: 0,
      artifactDir: ".devns/artifacts/browser-smoke/policy",
      stdout: ".devns/artifacts/browser-smoke/policy/stdout.log",
      stderr: ".devns/artifacts/browser-smoke/policy/stderr.log",
      artifacts: [
        {
          kind: "network",
          path: ".devns/artifacts/browser-smoke/policy/network.ndjson"
        }
      ]
    });
    await writeFile(path.join(cwd, ".devns", "artifacts", "browser-smoke", "policy", "stdout.log"), "browser ok\n");
    await writeFile(path.join(cwd, ".devns", "artifacts", "browser-smoke", "policy", "stderr.log"), "");
    await writeFile(
      path.join(cwd, ".devns", "artifacts", "browser-smoke", "policy", "network.ndjson"),
      '{"method":"POST","url":"https://analytics.example.com/collect","status":204}\n'
    );
    const policyInventory = await readInventory(cwd, policyConfig);
    policyInventory.features.push({
      id: "BROWSER-POLICY",
      title: "Browser policy smoke",
      description: "Verify configured browser artifact policy is enforced.",
      status: "done",
      priority: "P1",
      milestone: "Smoke",
      acceptanceCriteria: ["Browser smoke is policy compliant."],
      reviewDecision: "approved",
      evidence: [
        {
          type: "browser",
          summary: "Browser smoke captured network artifacts.",
          verificationType: "browser_smoke",
          artifactRefs: [".devns/artifacts/browser-smoke/policy/run.json"]
        }
      ]
    });
    await writeInventory(cwd, policyConfig, policyInventory);
    const policyValidation = await runHarnessValidation(cwd);
    assert.notEqual(policyValidation.status, "fail");
    assert.ok(
      policyValidation.checks.some(
        (check) =>
          check.id === "state.evidence_artifacts.BROWSER-POLICY" &&
          check.status === "warn" &&
          /blocked URL policy/.test(check.summary)
      )
    );

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
