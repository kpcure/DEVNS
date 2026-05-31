#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [
    "--import",
    path.join(packageRoot, "node_modules/tsx/dist/esm/index.mjs"),
    path.join(packageRoot, "packages/core/src/cli/devns.ts"),
    ...process.argv.slice(2)
  ],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
