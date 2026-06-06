#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
  const repoRoot = process.cwd();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-browser-smoke-"));
  const script = path.join(repoRoot, "templates", "devns", "adapters", "browser-smoke.sh");
  const artifactDir = ".devns/artifacts/browser-smoke/smoke";

  try {
    const { stdout } = await execFileAsync("bash", [script], {
      cwd,
      env: {
        ...process.env,
        DEVNS_REPO: cwd,
        DEVNS_BROWSER_SMOKE_COMMAND: "node -e \"process.stdout.write('browser ok')\"",
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
    };
    assert.equal(report.type, "browser_smoke");
    assert.equal(report.exitCode, 0);
    assert.match(report.command, /browser ok/);
    assert.match(await readFile(path.join(cwd, report.stdout), "utf8"), /browser ok/);
    assert.equal(await readFile(path.join(cwd, report.stderr), "utf8"), "");

    process.stdout.write("Browser smoke adapter smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown browser smoke adapter smoke error"}\n`);
  process.exitCode = 1;
});
