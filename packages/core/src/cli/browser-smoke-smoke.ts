#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { evaluateArtifactIntegrity } from "../harness/artifact-integrity";
import type { Feature } from "../harness/types";

const execFileAsync = promisify(execFile);

async function main() {
  const repoRoot = process.cwd();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-browser-smoke-"));
  const script = path.join(repoRoot, "templates", "devns", "adapters", "browser-smoke.sh");
  const artifactDir = ".devns/artifacts/browser-smoke/smoke";
  const smokeScript = [
    'const fs = require("node:fs");',
    "const dir = process.env.DEVNS_BROWSER_SMOKE_ARTIFACT_ABS_DIR;",
    'fs.writeFileSync(dir + "/screenshot.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64"));',
    'fs.writeFileSync(dir + "/console.ndjson", JSON.stringify({ type: "log", text: "ready" }) + "\\n");',
    'fs.writeFileSync(dir + "/network.ndjson", JSON.stringify({ method: "GET", url: "http://127.0.0.1/", status: 200 }) + "\\n");',
    'process.stdout.write("browser ok");'
  ].join(" ");
  const smokeCommand = `node -e ${JSON.stringify(smokeScript)}`;

  try {
    const { stdout } = await execFileAsync("bash", [script], {
      cwd,
      env: {
        ...process.env,
        DEVNS_REPO: cwd,
        DEVNS_BROWSER_SMOKE_COMMAND: smokeCommand,
        DEVNS_BROWSER_SMOKE_ARTIFACT_DIR: artifactDir
      }
    });

    assert.match(stdout, new RegExp(`DEVNS_ARTIFACT=${artifactDir}/run\\.json`));
    const report = JSON.parse(await readFile(path.join(cwd, artifactDir, "run.json"), "utf8")) as {
      type: string;
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      artifacts?: Array<{ kind: string; path: string; bytes: number }>;
    };
    assert.equal(report.type, "browser_smoke");
    assert.equal(report.exitCode, 0);
    assert.match(report.command, /browser ok/);
    assert.match(await readFile(path.join(cwd, report.stdout), "utf8"), /browser ok/);
    assert.equal(await readFile(path.join(cwd, report.stderr), "utf8"), "");
    assert.ok(report.artifacts?.some((item) => item.kind === "screenshot" && item.path.endsWith("/screenshot.png")));
    assert.ok(report.artifacts?.some((item) => item.kind === "console" && item.path.endsWith("/console.ndjson")));
    assert.ok(report.artifacts?.some((item) => item.kind === "network" && item.path.endsWith("/network.ndjson")));
    const feature: Feature = {
      id: "BROWSER-001",
      title: "Browser smoke artifact",
      description: "Verify browser smoke artifacts are inspectable.",
      status: "done",
      priority: "P0",
      milestone: "Smoke",
      acceptanceCriteria: ["Browser smoke artifact is inspectable."],
      evidence: [
        {
          type: "browser",
          summary: "Browser smoke produced a manifest.",
          verificationType: "browser_smoke",
          artifactRefs: [`${artifactDir}/run.json`]
        }
      ]
    };
    const integrity = await evaluateArtifactIntegrity(cwd, feature, {
      requireRichBrowserArtifacts: true,
      failOnConsoleError: true,
      failOnNetworkError: true
    });
    assert.equal(integrity.decision, "allow");

    process.stdout.write("Browser smoke adapter smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown browser smoke adapter smoke error"}\n`);
  process.exitCode = 1;
});
