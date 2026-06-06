#!/usr/bin/env node
import { chmod, copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAgentsIndex } from "../harness/agents-index";

type HostAdapter = "auto" | "codex" | "claude" | "both" | "none";

export type InitOptions = {
  force: boolean;
  projectName: string;
  projectDescription: string;
  host?: HostAdapter;
};

function parseArgs(argv: string[]): InitOptions {
  const options: InitOptions = {
    force: false,
    projectName: "DEVNS Project",
    projectDescription: "Describe the project background, migration goal, and constraints.",
    host: "auto"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      options.force = true;
    } else if (arg === "--project-name") {
      options.projectName = argv[index + 1] || options.projectName;
      index += 1;
    } else if (arg === "--project-description") {
      options.projectDescription = argv[index + 1] || options.projectDescription;
      index += 1;
    } else if (arg === "--host") {
      const host = argv[index + 1] as HostAdapter | undefined;
      if (host && ["auto", "codex", "claude", "both", "none"].includes(host)) {
        options.host = host;
      }
      index += 1;
    } else if (arg === "--no-host-adapter") {
      options.host = "none";
    }
  }

  return options;
}

async function writeNewFile(filePath: string, contents: string, force: boolean) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, contents, { flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
  return true;
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function hostAdaptersFor(host: HostAdapter) {
  if (host === "none") return [];
  if (host === "both") return ["codex", "claude"] as const;
  if (host === "codex" || host === "claude") return [host] as const;

  const adapters: Array<"codex" | "claude"> = [];
  if (process.env.CODEX_SHELL || process.env.CODEX_PROJECT_DIR || process.env.CODEX_THREAD_ID) {
    adapters.push("codex");
  }
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDECODE || process.env.CLAUDE_CODE) {
    adapters.push("claude");
  }
  return adapters;
}

async function copyNewFile(sourcePath: string, destinationPath: string, force: boolean) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await copyFile(sourcePath, destinationPath, force ? 0 : 1);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function copyNewDirectory(sourcePath: string, destinationPath: string, force: boolean) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await cp(sourcePath, destinationPath, {
      recursive: true,
      force,
      errorOnExist: !force
    });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ERR_FS_CP_EEXIST") {
      return false;
    }
    throw error;
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function writeCodexHooks(cwd: string, force: boolean) {
  const scriptPath = path.join(cwd, "plugins", "codex", "devns", "scripts", "devns-stop-hook.sh");
  const hooks = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `DEVNS_PROJECT_DIR=${shellQuote(cwd)} bash ${shellQuote(scriptPath)}`,
              statusMessage: "DEVNS stop hook"
            }
          ]
        }
      ]
    }
  };
  return writeNewFile(path.join(cwd, ".codex", "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`, force);
}

function reviewAgentAdapterFor(adapters: ReadonlyArray<"codex" | "claude">) {
  if (adapters.includes("codex")) return "codex";
  if (adapters.includes("claude")) return "claude";
  return undefined;
}

async function writeReviewAgentAdapter(cwd: string, adapter: "codex" | "claude", force: boolean) {
  const sourcePath = path.join(packageRoot, "templates", "devns", "adapters", `code-review.${adapter}.sh`);
  const destinationPath = path.join(cwd, ".devns", "adapters", `code-review.${adapter}.sh`);
  const didCopy = await copyNewFile(sourcePath, destinationPath, force);
  await chmod(destinationPath, 0o755);
  return didCopy;
}

async function writeBrowserSmokeAdapter(cwd: string, force: boolean) {
  const sourcePath = path.join(packageRoot, "templates", "devns", "adapters", "browser-smoke.sh");
  const destinationPath = path.join(cwd, ".devns", "adapters", "browser-smoke.sh");
  const didCopy = await copyNewFile(sourcePath, destinationPath, force);
  await chmod(destinationPath, 0o755);
  return didCopy;
}

async function writeReviewAgentLane(cwd: string, adapter: "codex" | "claude", force: boolean) {
  const lane = {
    id: "code-review",
    type: "agent",
    agent: adapter === "codex" ? "codex-review" : "devns-code-reviewer",
    command: `bash .devns/adapters/code-review.${adapter}.sh`,
    required: true,
    blocksCompletion: true
  };
  return writeNewFile(path.join(cwd, ".devns", "lanes", "code-review.json"), `${JSON.stringify(lane, null, 2)}\n`, force);
}

async function writeHostSubagents(cwd: string, adapter: "codex" | "claude", force: boolean) {
  const sourceDir =
    adapter === "codex"
      ? path.join(packageRoot, "plugins", "codex", "devns", "agents")
      : path.join(packageRoot, "plugins", "claude-code", "devns", "agents");
  const destinationDir = adapter === "codex" ? path.join(cwd, ".codex", "agents") : path.join(cwd, ".claude", "agents");
  const copied: Array<{ path: string; written: boolean }> = [];

  let entries: string[] = [];
  try {
    entries = await readdir(sourceDir);
  } catch {
    return copied;
  }

  for (const entry of entries.filter((item) => item.endsWith(adapter === "codex" ? ".toml" : ".md"))) {
    const destinationPath = path.join(destinationDir, entry);
    const didCopy = await copyNewFile(path.join(sourceDir, entry), destinationPath, force);
    copied.push({
      path: path.relative(cwd, destinationPath),
      written: didCopy
    });
  }

  return copied;
}

async function readPackageScripts(cwd: string) {
  try {
    const raw = await readFile(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function isDefaultNpmFailingTest(script: string) {
  return /Error:\s*no test specified/.test(script) && /exit\s+1/.test(script);
}

function recommendedReviewLanes(scripts: Record<string, string>) {
  const lanes = [];
  for (const script of ["test", "typecheck", "build"]) {
    if (script === "test" && isDefaultNpmFailingTest(scripts[script] ?? "")) {
      continue;
    }
    if (scripts[script]) {
      lanes.push({
        id: script,
        type: "command",
        command: `npm run ${script} --silent`,
        required: true,
        blocksCompletion: true
      });
    }
  }

  if (scripts.lint) {
    lanes.push({
      id: "lint",
      type: "command",
      command: "npm run lint --silent",
      required: false,
      blocksCompletion: false
    });
  }

  lanes.push({
    id: "security_basic",
    type: "builtin",
    required: false,
    blocksCompletion: false
  });

  return lanes;
}

export async function main(inputOptions?: InitOptions) {
  const cwd = process.cwd();
  const options = inputOptions ?? parseArgs(process.argv.slice(2));
  const host = options.host ?? "auto";
  const adapters = hostAdaptersFor(host);
  const reviewAdapter = reviewAgentAdapterFor(adapters);
  const devnsDir = path.join(cwd, ".devns");
  const scripts = await readPackageScripts(cwd);

  await mkdir(path.join(devnsDir, "rfcs"), { recursive: true });
  await mkdir(path.join(devnsDir, "history"), { recursive: true });
  await mkdir(path.join(devnsDir, "traces"), { recursive: true });
  await mkdir(path.join(devnsDir, "artifacts"), { recursive: true });
  await mkdir(path.join(devnsDir, "reviews"), { recursive: true });
  await mkdir(path.join(devnsDir, "skills"), { recursive: true });
  await mkdir(path.join(devnsDir, "agents"), { recursive: true });
  await mkdir(path.join(devnsDir, "adapters"), { recursive: true });
  await mkdir(path.join(devnsDir, "policies"), { recursive: true });
  await mkdir(path.join(devnsDir, "lanes"), { recursive: true });
  await mkdir(path.join(devnsDir, "sensors"), { recursive: true });
  await mkdir(path.join(devnsDir, "workbench"), { recursive: true });

  const files = [
    {
      path: path.join(devnsDir, "devns.config.json"),
      contents: json({
        $schema: "../tools/schema/devns-config.schema.json",
        version: 1,
        features: ".devns/features.json",
        candidates: ".devns/candidates.json",
        rfcs: ".devns/rfcs",
        history: ".devns/history",
        traces: ".devns/traces",
        policies: ".devns/policies",
        review: {
          mode: "html",
          outputDir: ".devns/reviews"
        },
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
            retryBudget: 3,
            defaultDecision: "stop_for_human_review",
            blockOn: {
              missingApprovedRfc: true,
              skippedRequiredVerification: true,
              outOfScopeFiles: true
            },
            reviewAgent: {
              mode: "run_missing",
              laneIds: ["code-review"],
              requireDeterministicEvidence: false
            }
          }
        },
        skills: {
          init: "devns-init",
          rfc: "devns-rfc",
          run: "devns-run"
        },
        reviewLanes: recommendedReviewLanes(scripts)
      })
    },
    {
      path: path.join(devnsDir, "features.json"),
      contents: json({
        $schema: "../tools/schema/features.schema.json",
        project: {
          name: options.projectName,
          description: options.projectDescription
        },
        features: []
      })
    },
    {
      path: path.join(devnsDir, "candidates.json"),
      contents: json({
        $schema: "../tools/schema/candidates.schema.json",
        candidates: [],
        notes: [
          "Run the devns-init skill to discover candidate features from repository context.",
          "Promote a candidate into features.json only after devns-rfc creates a reviewed RFC."
        ]
      })
    },
    {
      path: path.join(devnsDir, "project.md"),
      contents: [
        `# ${options.projectName}`,
        "",
        "## Background",
        "",
        options.projectDescription,
        "",
        "## Goal",
        "",
        options.projectDescription,
        "",
        "## Constraints",
        "",
        "- Add architecture, testing, release, and domain constraints here.",
        ""
      ].join("\n")
    },
    {
      path: path.join(devnsDir, "index.md"),
      contents: [
        "# DEVNS Index",
        "",
        "Use this file as the progressive-disclosure entrypoint for agents.",
        "",
        "## Files",
        "",
        "- `devns.config.json`: runtime configuration",
        "- `features.json`: executable features with approved RFCs",
        "- `candidates.json`: discovered candidates that are not ready for implementation",
        "- `rfcs/`: RFC records for candidate and executable features",
        "- `history/`: execution history and impact records",
        "- `traces/`: local orchestrator and harness trace records",
        "- `artifacts/`: generated verification artifacts such as browser smoke reports",
        "- `skills/`: project-local skill overrides",
        "- `policies/`: project-local harness policies",
        "- `project.md`: human-provided project background",
        "",
        "## Reading Order",
        "",
        "1. Run `npm run devns:doctor -- --json` when available. If missing, inspect `package.json` and use `npm run devns:status -- --json` or `npm run devns:queue -- status --json`.",
        "2. Read the active feature from `features.json` and its approved RFC from `rfcs/` or the feature record.",
        "3. Read the latest `.devns/history/<feature-id>.jsonl` record for decisions, pitfalls, errors, fixes, and lessons.",
        "4. Read `.devns/traces/orchestrator.jsonl` when debugging claim, handoff, or review-routing behavior.",
        "5. Read `.devns/reviews/` when reviewing completed work or taking over after a long run.",
        "",
        "## Rules",
        "",
        "- Run `devns-init` to discover candidates.",
        "- Run `devns-rfc` to clarify a candidate before implementation.",
        "- Only run `devns-run` for features with approved RFCs.",
        "- Do not keep multiple features active unless a future policy explicitly allows it.",
        "- Keep `features.json` concise; write detailed evidence, history, and review packets to linked artifacts.",
        ""
      ].join("\n")
    },
    {
      path: path.join(devnsDir, "README.md"),
      contents: [
        "# .devns",
        "",
        "This directory is the local DEVNS harness workspace.",
        "",
        "Agents and humans can both read it. Humans should edit project background, review RFCs, and approve ready work. Agents should not implement a feature until its RFC is approved.",
        "",
        "Agent quick path:",
        "",
        "1. Check mode with `npm run devns:doctor -- --json` when available; otherwise inspect `package.json` and use the available DEVNS status command.",
        "2. Read `index.md`, the active feature RFC, and relevant history before editing.",
        "3. Run lanes with `npm run devns:lanes -- run --write --json` before completion.",
        "4. Keep durable knowledge in `history/`, local workflow diagnostics in `traces/`, and human review packets in `reviews/`.",
        ""
      ].join("\n")
    }
  ];

  const workbenchTemplatePath = path.join(packageRoot, "templates", "workbench", "index.html");
  const workbenchOutputPath = path.join(devnsDir, "workbench", "index.html");

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const didWrite = await writeNewFile(file.path, file.contents, options.force);
    (didWrite ? written : skipped).push(path.relative(cwd, file.path));
  }

  const didCopyWorkbench = await copyNewFile(workbenchTemplatePath, workbenchOutputPath, options.force);
  (didCopyWorkbench ? written : skipped).push(path.relative(cwd, workbenchOutputPath));

  const didCopyBrowserSmokeAdapter = await writeBrowserSmokeAdapter(cwd, options.force);
  (didCopyBrowserSmokeAdapter ? written : skipped).push(".devns/adapters/browser-smoke.sh");

  if (reviewAdapter) {
    const didCopyAdapter = await writeReviewAgentAdapter(cwd, reviewAdapter, options.force);
    (didCopyAdapter ? written : skipped).push(`.devns/adapters/code-review.${reviewAdapter}.sh`);

    const didWriteLane = await writeReviewAgentLane(cwd, reviewAdapter, options.force);
    (didWriteLane ? written : skipped).push(".devns/lanes/code-review.json");
  }

  for (const adapter of adapters) {
    if (adapter === "codex") {
      const didCopyPlugin = await copyNewDirectory(
        path.join(packageRoot, "plugins", "codex", "devns"),
        path.join(cwd, "plugins", "codex", "devns"),
        options.force
      );
      (didCopyPlugin ? written : skipped).push("plugins/codex/devns");

      const didCopyHook = await writeCodexHooks(cwd, options.force);
      (didCopyHook ? written : skipped).push(".codex/hooks.json");

      await chmod(path.join(cwd, "plugins", "codex", "devns", "scripts", "devns-stop-hook.sh"), 0o755);

      for (const item of await writeHostSubagents(cwd, "codex", options.force)) {
        (item.written ? written : skipped).push(item.path);
      }
    } else if (adapter === "claude") {
      const didCopyPlugin = await copyNewDirectory(
        path.join(packageRoot, "plugins", "claude-code", "devns"),
        path.join(cwd, "plugins", "claude-code", "devns"),
        options.force
      );
      (didCopyPlugin ? written : skipped).push("plugins/claude-code/devns");

      const didCopySettings = await copyNewFile(
        path.join(packageRoot, "templates", "claude-code", ".claude", "settings.json"),
        path.join(cwd, ".claude", "settings.json"),
        options.force
      );
      (didCopySettings ? written : skipped).push(".claude/settings.json");

      for (const item of await writeHostSubagents(cwd, "claude", options.force)) {
        (item.written ? written : skipped).push(item.path);
      }
    }
  }

  await writeAgentsIndex(cwd, {
    configPath: ".devns/devns.config.json",
    featuresPath: ".devns/features.json",
    dashboardPath: ".devns/workbench/index.html"
  });
  written.push("AGENTS.md");

  process.stdout.write(
    [
      `Initialized DEVNS workspace at ${path.relative(cwd, devnsDir)}`,
      written.length ? `Created:\n${written.map((file) => `- ${file}`).join("\n")}` : "",
      skipped.length ? `Skipped existing files:\n${skipped.map((file) => `- ${file}`).join("\n")}` : ""
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown init error"}\n`);
    process.exitCode = 1;
  });
}
