#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

async function runHook(input: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("bash", ["plugins/codex/devns/scripts/devns-stop-hook.sh"], {
      cwd: process.cwd(),
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

async function main() {
  const stdout = await runHook(JSON.stringify({ cwd: process.cwd() }));

  if (stdout.trim()) {
    const payload = JSON.parse(stdout);
    assert.equal(payload.decision, "block");
    assert.equal(typeof payload.reason, "string");
  }

  process.stdout.write("Codex stop hook smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown Codex stop hook smoke error"}\n`);
  process.exitCode = 1;
});
