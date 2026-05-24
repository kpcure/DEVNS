#!/usr/bin/env node
import { changedFiles, commitFiles, gitStatus } from "../harness/git";
import { patchFeature, readConfig, readInventory } from "../harness/state";

type GitCommand = "status" | "commit";

type GitOptions = {
  command?: GitCommand;
  id?: string;
  files: string[];
  message?: string;
  output: "json" | "text";
};

function parseArgs(argv: string[]): GitOptions {
  const options: GitOptions = {
    command: argv[0] as GitCommand | undefined,
    files: [],
    output: "text"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[index + 1];
      index += 1;
    } else if (arg === "--files") {
      options.files = (argv[index + 1] || "")
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === "--message") {
      options.message = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
    }
  }

  return options;
}

function usage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run devns:git -- status [--json]",
      "  npm run devns:git -- commit --id <feature-id> --files <comma-separated-files> [--message <message>] [--json]"
    ].join("\n") + "\n"
  );
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function status(cwd: string, output: GitOptions["output"]) {
  const entries = await gitStatus(cwd);
  const payload = {
    clean: entries.length === 0,
    entries,
    changedFiles: entries.map((entry) => entry.path)
  };

  if (output === "json") {
    writeJson(payload);
    return;
  }

  if (payload.clean) {
    process.stdout.write("Git worktree is clean.\n");
    return;
  }

  process.stdout.write(payload.entries.map((entry) => entry.raw).join("\n") + "\n");
}

async function commit(cwd: string, options: GitOptions) {
  if (!options.id) {
    throw new Error("Missing --id <feature-id>.");
  }
  if (!options.files.length) {
    throw new Error("Missing --files. DevNS requires explicit files to avoid staging unrelated work.");
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = inventory.features.find((item) => item.id === options.id);
  if (!feature) {
    throw new Error(`Feature ${options.id} not found.`);
  }

  const message = options.message ?? `${feature.id}: ${feature.title}`;
  const commit = await commitFiles(cwd, options.files, message);
  const changed = await changedFiles(cwd);

  await patchFeature(cwd, config, feature.id, {
    commit,
    changedFiles: options.files,
    evidence: [
      ...(feature.evidence ?? []),
      {
        type: "git",
        summary: `Committed ${options.files.length} file(s) as ${commit}.`
      }
    ],
    reviewDecision: feature.reviewDecision === "pending" ? "approved" : feature.reviewDecision
  });

  const payload = {
    id: feature.id,
    commit,
    committedFiles: options.files,
    remainingChangedFiles: changed
  };

  if (options.output === "json") {
    writeJson(payload);
    return;
  }

  process.stdout.write(`Committed ${feature.id} as ${commit}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!options.command || !["status", "commit"].includes(options.command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (options.command === "status") {
    await status(cwd, options.output);
    return;
  }

  await commit(cwd, options);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown git command error"}\n`);
  process.exitCode = 1;
});
