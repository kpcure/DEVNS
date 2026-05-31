#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runDevns(repoRoot: string, cwd: string, ...args: string[]) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
      path.join(repoRoot, "packages/core/src/cli/devns.ts"),
      ...args
    ], { cwd });
    return stdout;
  } catch (error) {
    const execError = error as Error & { stdout?: string };
    if (execError.stdout) return execError.stdout;
    throw error;
  }
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-install-dogfood-"));
  const repoRoot = process.cwd();

  try {
    await writeFile(
      path.join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "devns-install-dogfood",
          version: "0.0.0",
          scripts: {
            test: "echo \"Error: no test specified\" && exit 1"
          },
          devDependencies: {
            devns: "file:../never-stop"
          }
        },
        null,
        2
      )}\n`
    );

    const bootstrap = JSON.parse(await runDevns(repoRoot, cwd, "doctor", "--json"));
    assert.equal(bootstrap.mode, "bootstrap_required");

    await runDevns(repoRoot, cwd, "init", "--project-name", "Install Dogfood", "--project-description", "Dogfood install entrypoint.");

    const config = JSON.parse(await readFile(path.join(cwd, ".devns", "devns.config.json"), "utf8"));
    assert.equal(config.reviewLanes.some((lane: { id: string }) => lane.id === "test"), false);

    const emptyRfc = JSON.parse(await runDevns(repoRoot, cwd, "rfc", "check", "--all", "--json"));
    assert.deepEqual(emptyRfc, { results: [], ready: true });

    const lanes = JSON.parse(await runDevns(repoRoot, cwd, "lanes", "run", "--json"));
    assert.equal(lanes.blocksCompletion, false);
    assert.ok(lanes.results.some((result: { lane: string }) => result.lane === "security_basic"));

    const validation = JSON.parse(await runDevns(repoRoot, cwd, "validate", "--json"));
    assert.equal(validation.summary.fail, 0);
    assert.ok(
      validation.checks.some(
        (check: { id: string; status: string; summary: string }) =>
          check.id === "hook.stop_script" &&
          check.status === "pass" &&
          /DEVNS package entrypoint/.test(check.summary)
      )
    );

    process.stdout.write("Install dogfood smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown install dogfood smoke error"}\n`);
  process.exitCode = 1;
});
