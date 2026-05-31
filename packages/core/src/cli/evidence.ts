#!/usr/bin/env node
import { appendExecutionHistory, buildChangedFileEvidence } from "../harness/history";
import { patchFeature, readConfig, readInventory } from "../harness/state";
import type { Evidence, Feature, VerificationType } from "../harness/types";

type EvidenceCommand = "add";

type EvidenceOptions = {
  command?: EvidenceCommand;
  featureId?: string;
  type?: string;
  summary?: string;
  actor?: string;
  url?: string;
  artifactRefs: string[];
  coversAcceptanceCriteriaIds: string[];
  coversRequirementIds: string[];
  verificationType?: VerificationType;
  output: "json" | "text";
};

function parseList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): EvidenceOptions {
  const options: EvidenceOptions = {
    command: argv[0] as EvidenceCommand | undefined,
    artifactRefs: [],
    coversAcceptanceCriteriaIds: [],
    coversRequirementIds: [],
    output: "text"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--feature" || arg === "--id") {
      options.featureId = argv[++index];
    } else if (arg === "--type") {
      options.type = argv[++index];
    } else if (arg === "--summary") {
      options.summary = argv[++index];
    } else if (arg === "--actor") {
      options.actor = argv[++index];
    } else if (arg === "--url") {
      options.url = argv[++index];
    } else if (arg === "--artifact" || arg === "--artifact-ref") {
      options.artifactRefs.push(argv[++index]);
    } else if (arg === "--covers-ac") {
      options.coversAcceptanceCriteriaIds.push(...parseList(argv[++index]));
    } else if (arg === "--covers-req") {
      options.coversRequirementIds.push(...parseList(argv[++index]));
    } else if (arg === "--verification") {
      options.verificationType = argv[++index] as VerificationType;
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
      "  devns evidence add --feature <id> --type <type> --summary <text> [--verification browser_smoke|human_review|review_agent|command|static_review]",
      "",
      "Optional:",
      "  --actor <name> --covers-ac AC-001,AC-002 --covers-req REQ-001 --artifact <path-or-url> --url <url> --json"
    ].join("\n") + "\n"
  );
}

function selectedFeature(features: Feature[], featureId?: string) {
  return featureId ? features.find((feature) => feature.id === featureId) : features.find((feature) => feature.status === "in_progress");
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "add") {
    usage();
    process.exitCode = 1;
    return;
  }

  if (!options.type || !options.summary) {
    throw new Error("evidence add requires --type and --summary.");
  }

  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = selectedFeature(inventory.features, options.featureId);
  if (!feature) {
    throw new Error(options.featureId ? `Feature ${options.featureId} not found.` : "No active feature found.");
  }

  const evidence: Evidence = {
    type: options.type,
    summary: options.summary,
    actor: options.actor ?? "devns-evidence",
    producedAt: new Date().toISOString()
  };
  if (options.url) evidence.url = options.url;
  if (options.artifactRefs.length) evidence.artifactRefs = options.artifactRefs;
  if (options.coversAcceptanceCriteriaIds.length) evidence.coversAcceptanceCriteriaIds = options.coversAcceptanceCriteriaIds;
  if (options.coversRequirementIds.length) evidence.coversRequirementIds = options.coversRequirementIds;
  if (options.verificationType) evidence.verificationType = options.verificationType;

  const history = await appendExecutionHistory(cwd, config, {
    featureId: feature.id,
    actor: options.actor === "human" ? "human" : "agent",
    summary: `Recorded evidence ${evidence.type}: ${evidence.summary}`,
    decisions: ["Record external review/browser/human evidence through the CLI instead of hand-editing features.json."],
    alternativesRejected: ["Do not rely on --force completion when review evidence can be recorded explicitly."],
    changedFiles: buildChangedFileEvidence(feature),
    impact: [`Evidence ${evidence.type} added to ${feature.id}.`],
    risks: [],
    dynamicChecks: [],
    staticChecks: []
  });

  const result = await patchFeature(cwd, config, feature.id, {
    evidence: [...(feature.evidence ?? []), evidence],
    history: history.summary
  });

  const payload = { featureId: feature.id, evidence, history: history.summary, revision: result.revision };
  if (options.output === "json") {
    writeJson(payload);
    return;
  }
  process.stdout.write(`Recorded evidence for ${feature.id}: ${evidence.type}\n`);
}

main().catch((error) => {
  if (process.argv.includes("--json")) {
    writeJson({ error: error instanceof Error ? error.message : "Unknown evidence command error" });
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown evidence command error"}\n`);
  process.exitCode = 1;
});
