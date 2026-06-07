#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CommandTarget =
  | {
      type: "tsx";
      file: string;
    }
  | {
      type: "dashboard";
    };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(import.meta.url);
const tsxLoader = require.resolve("tsx/esm");
const vitePackageRoot = path.dirname(require.resolve("vite/package.json"));
const viteBin = path.join(vitePackageRoot, "bin/vite.js");

const commands: Record<string, CommandTarget> = {
  init: { type: "tsx", file: "packages/core/src/cli/init.ts" },
  doctor: { type: "tsx", file: "packages/core/src/cli/doctor.ts" },
  status: { type: "tsx", file: "packages/core/src/cli/queue.ts" },
  dashboard: { type: "dashboard" },
  run: { type: "tsx", file: "packages/core/src/cli/run.ts" },
  orchestrate: { type: "tsx", file: "packages/core/src/cli/orchestrate.ts" },
  discover: { type: "tsx", file: "packages/core/src/cli/discover.ts" },
  complete: { type: "tsx", file: "packages/core/src/cli/complete.ts" },
  evidence: { type: "tsx", file: "packages/core/src/cli/evidence.ts" },
  eval: { type: "tsx", file: "packages/core/src/cli/eval.ts" },
  trace: { type: "tsx", file: "packages/core/src/cli/trace.ts" },
  lanes: { type: "tsx", file: "packages/core/src/cli/lanes.ts" },
  "stop-log": { type: "tsx", file: "packages/core/src/cli/stop-log.ts" },
  review: { type: "tsx", file: "packages/core/src/cli/morning-review.ts" },
  queue: { type: "tsx", file: "packages/core/src/cli/queue.ts" },
  rfc: { type: "tsx", file: "packages/core/src/cli/rfc.ts" },
  stop: { type: "tsx", file: "packages/core/src/cli/stop-hook.ts" },
  validate: { type: "tsx", file: "packages/core/src/cli/validate.ts" }
};

function usage() {
  return [
    "DEVNS single entrypoint",
    "",
    "Usage:",
    "  devns doctor [--json]",
    "  devns init --project-name \"Project\" --project-description \"Goal\"",
    "  devns run [--json] [--no-claim]",
    "  devns orchestrate [--host claude|codex|generic] [--json] [--no-claim]",
    "  devns lanes run [--feature <id>] [--write] [--json]",
    "  devns evidence add --feature <id> --type <type> --summary <text>",
    "  devns eval run --tier t1 [--mode <mode>] [--json]",
    "  devns eval run --all [--report evals/out/report.md] [--history evals/out/eval-history.jsonl]",
    "  devns trace [--tail 20] [--audit] [--json]",
    "  devns trace worker-result --feature <id> --status implemented|blocked|failed [--json]",
    "  devns trace repair --feature <id> --phase requested|result [--reason <text>] [--json]",
    "  devns stop-log [--tail 20] [--json]",
    "  devns review generate [--date YYYY-MM-DD] [--json]",
    "  devns review packet [--feature <id>] [--format json|prompt] [--write]",
    "  devns complete [--id <feature-id>] [--commit <sha>] [--json]",
    "  devns dashboard",
    "  devns validate [--json] [--strict] [--fix]",
    "",
    "Internal scripts still exist for hooks, skills, and development, but humans and agents should start here."
  ].join("\n");
}

function normalizeCommand(value?: string) {
  if (!value || value === "help" || value === "--help" || value === "-h") return undefined;
  return value.replace(/^devns:/, "").replace(/^harness:/, "");
}

async function main() {
  const [rawCommand, ...args] = process.argv.slice(2);
  const command = normalizeCommand(rawCommand);

  if (!command) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const target = commands[command];
  if (!target) {
    process.stderr.write(`Unknown DEVNS command: ${rawCommand}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const child =
    target.type === "dashboard"
      ? spawn(process.execPath, [viteBin, "--host", "127.0.0.1"], {
          stdio: "inherit",
          cwd: packageRoot,
          env: {
            ...process.env,
            DEVNS_PROJECT_DIR: process.cwd(),
            DEVNS_FEATURES_PATH: path.resolve(process.cwd(), ".devns/features.json"),
            DEVNS_CANDIDATES_PATH: path.resolve(process.cwd(), ".devns/candidates.json")
          }
        })
      : spawn(process.execPath, ["--import", tsxLoader, path.join(packageRoot, target.file), ...args], {
          stdio: "inherit",
          cwd: process.cwd(),
          env: process.env
        });

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
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown DEVNS entrypoint error"}\n`);
  process.exitCode = 1;
});
