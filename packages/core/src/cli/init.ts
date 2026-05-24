#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeAgentsIndex } from "../harness/agents-index";

export type InitOptions = {
  force: boolean;
  projectName: string;
  projectDescription: string;
};

function parseArgs(argv: string[]): InitOptions {
  const options: InitOptions = {
    force: false,
    projectName: "DevNS Project",
    projectDescription: "Describe the project background, migration goal, and constraints."
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
    }
  }

  return options;
}

async function writeNewFile(filePath: string, contents: string, force: boolean) {
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

export async function main(inputOptions?: InitOptions) {
  const cwd = process.cwd();
  const options = inputOptions ?? parseArgs(process.argv.slice(2));
  const devnsDir = path.join(cwd, ".devns");

  await mkdir(path.join(devnsDir, "rfcs"), { recursive: true });
  await mkdir(path.join(devnsDir, "history"), { recursive: true });
  await mkdir(path.join(devnsDir, "skills"), { recursive: true });
  await mkdir(path.join(devnsDir, "agents"), { recursive: true });
  await mkdir(path.join(devnsDir, "policies"), { recursive: true });
  await mkdir(path.join(devnsDir, "lanes"), { recursive: true });
  await mkdir(path.join(devnsDir, "sensors"), { recursive: true });

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
        policies: ".devns/policies",
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
            }
          }
        },
        skills: {
          init: "devns-init",
          rfc: "devns-rfc",
          run: "devns-run"
        }
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
        "- Fill in the migration or feature goal before running `devns-init`.",
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
        "# DevNS Index",
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
        "- `skills/`: project-local skill overrides",
        "- `policies/`: project-local harness policies",
        "- `project.md`: human-provided project background",
        "",
        "## Rules",
        "",
        "- Run `devns-init` to discover candidates.",
        "- Run `devns-rfc` to clarify a candidate before implementation.",
        "- Only run `devns-run` for features with approved RFCs.",
        ""
      ].join("\n")
    },
    {
      path: path.join(devnsDir, "README.md"),
      contents: [
        "# .devns",
        "",
        "This directory is the local DevNS harness workspace.",
        "",
        "Agents and humans can both read it. Humans should edit project background, review RFCs, and approve ready work. Agents should not implement a feature until its RFC is approved.",
        ""
      ].join("\n")
    }
  ];

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const didWrite = await writeNewFile(file.path, file.contents, options.force);
    (didWrite ? written : skipped).push(path.relative(cwd, file.path));
  }

  await writeAgentsIndex(cwd, {
    configPath: ".devns/devns.config.json",
    featuresPath: ".devns/features.json",
    dashboardPath: "apps/dashboard",
    workbenchPath: ".workbench"
  });
  written.push("AGENTS.md");

  process.stdout.write(
    [
      `Initialized DevNS workspace at ${path.relative(cwd, devnsDir)}`,
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
