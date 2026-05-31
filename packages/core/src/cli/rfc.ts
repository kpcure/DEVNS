#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClarificationQuestions, createRfcScaffold, evaluateRfcReadiness } from "../harness/rfc";
import { readCandidates, readConfig, readInventory, resolveFromCwd, writeInventory, writeJsonFile } from "../harness/state";
import type { CandidateFeature, CandidateInventory, Feature, FeatureInventory, FeaturePriority, FeatureRfc } from "../harness/types";

type RfcCommand = "scaffold" | "check" | "apply" | "clarify";

type RfcOptions = {
  command?: RfcCommand;
  id?: string;
  all: boolean;
  output?: "json" | "text";
  force: boolean;
};

function parseArgs(argv: string[]): RfcOptions {
  const options: RfcOptions = {
    command: argv[0] as RfcCommand | undefined,
    all: false,
    output: "text",
    force: false
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[index + 1];
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--force") {
      options.force = true;
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run devns:rfc -- scaffold --id <candidate-or-feature-id> [--force] [--json]",
      "  npm run devns:rfc -- scaffold --all [--force] [--json]",
      "  npm run devns:rfc -- check --id <feature-id> [--json]",
      "  npm run devns:rfc -- check --all [--json]",
      "  npm run devns:rfc -- clarify --id <candidate-or-feature-id> [--json]",
      "  npm run devns:rfc -- apply --id <candidate-or-feature-id> [--json]",
      "  npm run devns:rfc -- apply --all [--json]"
    ].join("\n") + "\n"
  );
}

function findCandidate(candidates: CandidateFeature[], id: string) {
  return candidates.find((candidate) => candidate.id === id);
}

function uniqueSources(candidates: CandidateFeature[], inventory: FeatureInventory) {
  const byId = new Map<string, CandidateFeature | Feature>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  for (const feature of inventory.features) {
    byId.set(feature.id, feature);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function writeRfcScaffold(cwd: string, rfcDir: string, source: CandidateFeature | Feature, force: boolean) {
  const rfc = createRfcScaffold(source);
  const outPath = path.join(rfcDir, `${source.id}.json`);

  try {
    await writeFile(
      outPath,
      `${JSON.stringify({ $schema: "../../tools/schema/rfc.schema.json", id: source.id, title: source.title, rfc }, null, 2)}\n`,
      {
        flag: force ? "w" : "wx"
      }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        id: source.id,
        path: path.relative(cwd, outPath),
        status: "skipped",
        reason: "RFC already exists; pass --force to overwrite."
      };
    }
    throw error;
  }

  return {
    id: source.id,
    path: path.relative(cwd, outPath),
    status: "created"
  };
}

async function scaffoldRfc(cwd: string, options: RfcOptions) {
  const config = await readConfig(cwd);
  const candidates = await readCandidates(cwd, config);
  const inventory = await readInventory(cwd, config);
  const rfcDir = resolveFromCwd(cwd, config.rfcs ?? ".devns/rfcs");
  await mkdir(rfcDir, { recursive: true });

  const sources = options.all
    ? uniqueSources(candidates.candidates, inventory)
    : [findCandidate(candidates.candidates, options.id ?? "") ?? inventory.features.find((item) => item.id === options.id)];

  if (sources.some((source) => !source)) {
    throw new Error(`Unable to find candidate or feature ${options.id}`);
  }

  const results = [];
  for (const source of sources) {
    results.push(await writeRfcScaffold(cwd, rfcDir, source as CandidateFeature | Feature, options.force));
  }

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    results
      .map((result) =>
        result.status === "created" ? `Created RFC scaffold at ${result.path}` : `Skipped ${result.id}: ${result.reason}`
      )
      .join("\n") + "\n"
  );
}

function checkFeature(feature: Feature) {
  return { id: feature.id, ...evaluateRfcReadiness(feature) };
}

async function checkRfc(cwd: string, options: RfcOptions) {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const features = options.all ? inventory.features : inventory.features.filter((item) => item.id === options.id);

  if (!features.length) {
    if (options.all) {
      if (options.output === "json") {
        process.stdout.write(`${JSON.stringify({ results: [], ready: true }, null, 2)}\n`);
        return;
      }
      process.stdout.write("No features to check.\n");
      return;
    }
    throw new Error(`Unable to find feature ${options.id}`);
  }

  const results = features.map(checkFeature);
  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify({ results, ready: results.every((result) => result.ready) }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    results
      .map((result) =>
        result.ready
          ? `Feature ${result.id} has a claimable RFC.`
          : [`Feature ${result.id} RFC is not claimable.`, ...result.reasons.map((reason) => `- ${reason}`)].join("\n")
      )
      .join("\n") + "\n"
  );
}

async function readRfcRecord(rfcDir: string, id: string) {
  const raw = await readFile(path.join(rfcDir, `${id}.json`), "utf8");
  return JSON.parse(raw) as { id: string; title: string; rfc: FeatureRfc };
}

async function readOptionalRfcRecord(rfcDir: string, id: string) {
  try {
    return await readRfcRecord(rfcDir, id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function clarifyRfc(cwd: string, options: RfcOptions) {
  if (!options.id) {
    throw new Error("Missing --id <candidate-or-feature-id>.");
  }

  const config = await readConfig(cwd);
  const candidates = await readCandidates(cwd, config);
  const inventory = await readInventory(cwd, config);
  const rfcDir = resolveFromCwd(cwd, config.rfcs ?? ".devns/rfcs");
  const projectContext = await readFile(resolveFromCwd(cwd, ".devns/project.md"), "utf8").catch(() => "");
  const feature = inventory.features.find((item) => item.id === options.id);
  const candidate = findCandidate(candidates.candidates, options.id);
  const record = await readOptionalRfcRecord(rfcDir, options.id);
  const rfc = feature?.rfc ?? record?.rfc ?? (candidate ? createRfcScaffold(candidate) : undefined);

  if (!rfc) {
    throw new Error(`Unable to find candidate, feature, or RFC ${options.id}`);
  }

  const questions = rfc.clarificationQuestions?.length ? rfc.clarificationQuestions : createClarificationQuestions(rfc, projectContext);
  const payload = {
    id: options.id,
    questions,
    blocking: questions.filter((question) => question.blocking)
  };

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `Clarification questions for ${options.id}:`,
      ...questions.map((question) =>
        [
          `- ${question.id}: ${question.question}`,
          `  Recommended: ${question.recommended}`,
          ...question.options.map((option, index) => `  ${index + 1}. ${option}`)
        ].join("\n")
      )
    ].join("\n") + "\n"
  );
}

function featureFromCandidate(candidate: CandidateFeature, rfc: FeatureRfc): Feature {
  const implementationTitle =
    /primary workflow|define mvp|verification|review evidence/i.test(candidate.title) && rfc.summary.trim()
      ? rfc.summary.replace(/^Clarify\s+/i, "").replace(/\.$/, "")
      : candidate.title;
  return {
    id: candidate.id,
    title: implementationTitle,
    description: candidate.description,
    status: rfc.status === "approved" && rfc.humanDecision?.status === "approved" ? "ready" : "blocked",
    priority: candidate.suggestedPriority ?? ("P2" satisfies FeaturePriority),
    milestone: candidate.suggestedMilestone ?? "Unscheduled",
    context: candidate.sources ?? [],
    acceptanceCriteria: rfc.acceptanceCriteria.map((criterion) => criterion.statement).filter(Boolean),
    verification: [...rfc.validationPlan.dynamic, ...rfc.validationPlan.static],
    evidence: [],
    changedFiles: [],
    reviewDecision: "pending",
    agentNotes: "Promoted from candidate by devns:rfc apply.",
    rfc
  };
}

async function applyRfc(cwd: string, options: RfcOptions) {
  const config = await readConfig(cwd);
  const candidates = await readCandidates(cwd, config);
  const inventory = await readInventory(cwd, config);
  const rfcDir = resolveFromCwd(cwd, config.rfcs ?? ".devns/rfcs");
  const ids = options.all
    ? [...new Set([...candidates.candidates.map((candidate) => candidate.id), ...inventory.features.map((feature) => feature.id)])].sort()
    : [options.id as string];

  const results = [];

  for (const id of ids) {
    const record = await readRfcRecord(rfcDir, id);
    const feature = inventory.features.find((item) => item.id === id);
    if (feature) {
      feature.rfc = record.rfc;
      if (feature.status === "blocked" && evaluateRfcReadiness(feature).ready) {
        feature.status = "ready";
      }
      results.push({ id, status: "updated" });
      continue;
    }

    const candidate = findCandidate(candidates.candidates, id);
    if (!candidate) {
      results.push({ id, status: "skipped", reason: "No matching feature or candidate." });
      continue;
    }

    const promoted = featureFromCandidate(candidate, record.rfc);
    inventory.features.push(promoted);
    candidate.status = "promoted";
    results.push({ id, status: "promoted" });
  }

  await writeInventory(cwd, config, inventory);
  if (config.candidates) {
    await writeJsonFile(resolveFromCwd(cwd, config.candidates), candidates satisfies CandidateInventory);
  }

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    results.map((result) => `${result.id}: ${result.status}${"reason" in result ? ` (${result.reason})` : ""}`).join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!options.command || !["scaffold", "check", "apply", "clarify"].includes(options.command) || (!options.id && !options.all)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.command === "scaffold") {
    await scaffoldRfc(cwd, options);
    return;
  }

  if (options.command === "check") {
    await checkRfc(cwd, options);
    return;
  }

  if (options.command === "clarify") {
    await clarifyRfc(cwd, options);
    return;
  }

  await applyRfc(cwd, options);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown RFC command error"}\n`);
  process.exitCode = 1;
});
