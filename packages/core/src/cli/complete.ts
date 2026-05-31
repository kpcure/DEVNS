#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendExecutionHistory, buildChangedFileEvidence } from "../harness/history";
import { evaluateEvidenceQuality } from "../harness/evidence-quality";
import { patchFeature, readConfig, readInventory } from "../harness/state";
import type { Evidence, Feature, FeaturePatch, ReviewDecision } from "../harness/types";

const execFileAsync = promisify(execFile);

type Options = {
  id?: string;
  review: ReviewDecision;
  commit?: string;
  metadataCommit?: string;
  force: boolean;
  reason?: string;
  output: "text" | "json";
};

function parseArgs(argv: string[]): Options {
  const options: Options = { review: "approved", force: false, output: "text" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[index + 1];
      index += 1;
    } else if (arg === "--review") {
      options.review = (argv[index + 1] as ReviewDecision | undefined) ?? options.review;
      index += 1;
    } else if (arg === "--commit") {
      options.commit = argv[index + 1];
      index += 1;
    } else if (arg === "--metadata-commit") {
      options.metadataCommit = argv[index + 1];
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--reason") {
      options.reason = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
    }
  }
  return options;
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function resolveCommit(cwd: string, value?: string) {
  return git(cwd, ["rev-parse", value ?? "HEAD"]);
}

async function filesForCommit(cwd: string, commit: string) {
  try {
    const stdout = await git(cwd, ["show", "--name-only", "--format=", commit]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findFeature(features: Feature[], id?: string) {
  return id ? features.find((feature) => feature.id === id) : features.find((feature) => feature.status === "in_progress");
}

function splitChangedFiles(files: string[]) {
  const stateFiles = files.filter((file) => file.startsWith(".devns/"));
  const implementationFiles = files.filter((file) => !file.startsWith(".devns/"));
  return { implementationFiles, stateFiles };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = findFeature(inventory.features, options.id);

  if (!feature) {
    throw new Error(options.id ? `Feature ${options.id} not found.` : "No active feature found.");
  }

  const implementationCommit = await resolveCommit(cwd, options.commit);
  const changedFiles = feature.changedFiles?.length ? feature.changedFiles : await filesForCommit(cwd, implementationCommit);
  const { implementationFiles, stateFiles } = splitChangedFiles(changedFiles);
  const evidenceQuality = evaluateEvidenceQuality({
    ...feature,
    changedFiles,
    evidence: [...(feature.evidence ?? []), { type: "git", summary: `Implementation commit ${implementationCommit} is ready to record.` }]
  });
  if (evidenceQuality.decision === "block") {
    throw new Error(`${evidenceQuality.summary} Run verification lanes and record evidence before completing ${feature.id}.`);
  }
  const hasReviewEvidence = (feature.evidence ?? []).some(
    (item) =>
      /review|human|manual|browser|e2e|visual/i.test(item.type) ||
      ["review_agent", "human_review", "browser_smoke"].includes(item.verificationType ?? "")
  );
  if (options.force && !options.reason?.trim()) {
    throw new Error("--force requires --reason so the override is auditable.");
  }
  if (options.review === "approved" && (evidenceQuality.decision === "needs_human_review" || !hasReviewEvidence) && !options.force) {
    throw new Error(
      [
        `${feature.id} still needs human or read-only review evidence before approved completion.`,
        evidenceQuality.summary,
        "Run `npx @kpcure/devns review packet --feature <id> --format prompt --write`, record reviewer/human evidence, or pass --force for an explicit override."
      ].join(" ")
    );
  }
  const evidence: Evidence[] = [
    ...(feature.evidence ?? []),
    {
      type: "git",
      summary: `Implementation commit ${implementationCommit} recorded for ${feature.id}.`,
      actor: "devns-complete",
      producedAt: new Date().toISOString()
    }
  ];
  if (options.force) {
    evidence.push({
      type: "completion-override",
      summary: `Approved completion forced: ${options.reason}`,
      actor: "devns-complete",
      producedAt: new Date().toISOString(),
      verificationType: "human_review"
    });
  }

  const history = await appendExecutionHistory(cwd, config, {
    featureId: feature.id,
    actor: "agent",
    summary: `Completed ${feature.id} with implementation commit ${implementationCommit}.`,
    decisions: [
      "Record implementation commit separately from optional DEVNS metadata commit.",
      ...(options.force ? [`Force override used during completion: ${options.reason}`] : [])
    ],
    alternativesRejected: ["Do not require a feature commit to contain its own final metadata commit hash."],
    changedFiles: buildChangedFileEvidence({ ...feature, changedFiles }),
    impact: [`Feature ${feature.id} marked done through devns complete.`],
    pitfalls: [
      {
        summary: "A feature commit cannot know the hash of a later metadata commit.",
        prevention: "Use implementationCommit for code changes and metadataCommit for a later state-only update when needed."
      }
    ],
    errors: [],
    fixes: [],
    lessons: ["Use `npx @kpcure/devns complete` instead of hand-editing feature completion fields."],
    risks: options.force ? [`Completion was forced: ${options.reason}`] : [],
    dynamicChecks: [],
    staticChecks: []
  });

  const patch: FeaturePatch = {
    status: "done",
    reviewDecision: options.review,
    commit: implementationCommit,
    implementationCommit,
    changedFiles,
    implementationFiles,
    stateFiles,
    evidence,
    history: history.summary,
    events: [
      ...(feature.events ?? []),
      {
        type: "completed",
        at: new Date().toISOString(),
        by: "devns-complete",
        summary: `Completed with implementation commit ${implementationCommit}.`
      }
    ]
  };
  if (options.metadataCommit) {
    patch.metadataCommit = options.metadataCommit;
  }

  const result = await patchFeature(cwd, config, feature.id, patch);

  const payload = {
    feature: result.feature,
    implementationCommit,
    metadataCommit: options.metadataCommit,
    changedFiles,
    history: history.summary
  };

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Completed ${feature.id} with implementation commit ${implementationCommit}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown complete command error"}\n`);
  process.exitCode = 1;
});
