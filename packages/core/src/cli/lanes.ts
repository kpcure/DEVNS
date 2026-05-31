#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { appendExecutionHistory, buildChangedFileEvidence, laneResultsToChecks } from "../harness/history";
import { laneResultsToEvidence, runReviewLanes, type LaneResult } from "../harness/lane-runner";
import { patchFeature, readConfig, readInventory } from "../harness/state";
import type { Feature } from "../harness/types";
import laneResultSchema from "../../../../tools/schema/lane-result.schema.json";
import { validateSchema } from "../harness/schema-validator";

type LaneCommand = "run" | "ingest";

type LaneOptions = {
  command?: LaneCommand;
  featureId?: string;
  resultPath?: string;
  actor?: string;
  write: boolean;
  output: "json" | "text";
};

function parseArgs(argv: string[]): LaneOptions {
  const options: LaneOptions = {
    command: argv[0] as LaneCommand | undefined,
    write: false,
    output: "text"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--feature" || arg === "--id") {
      options.featureId = argv[index + 1];
      index += 1;
    } else if (arg === "--result") {
      options.resultPath = argv[index + 1];
      index += 1;
    } else if (arg === "--actor") {
      options.actor = argv[index + 1];
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
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
      "  npm run devns:lanes -- run [--feature <feature-id>] [--write] [--json]",
      "  npm run devns:lanes -- ingest --feature <feature-id> --result <lane-result.json> [--actor review-agent:<name>] [--json]",
      "",
      "--write appends the full lane result envelope to feature history and stores concise evidence on the feature."
    ].join("\n") + "\n"
  );
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function activeOrSelectedFeature(features: Feature[], featureId?: string) {
  if (featureId) {
    return features.find((feature) => feature.id === featureId);
  }
  return features.find((feature) => feature.status === "in_progress");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "run" && options.command !== "ingest") {
    usage();
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = activeOrSelectedFeature(inventory.features, options.featureId);

  if ((options.featureId || options.write) && !feature) {
    throw new Error(options.featureId ? `Feature ${options.featureId} not found.` : "No active feature found for --write.");
  }

  if (options.command === "ingest") {
    if (!feature) {
      throw new Error(options.featureId ? `Feature ${options.featureId} not found.` : "No active feature found for ingest.");
    }
    if (!options.resultPath) {
      throw new Error("lanes ingest requires --result <lane-result.json>.");
    }
    const raw = await readFile(options.resultPath, "utf8");
    const laneResult = JSON.parse(raw) as LaneResult;
    const schemaResult = validateSchema(laneResult, laneResultSchema);
    if (!schemaResult.valid) {
      throw new Error(`Lane result schema validation failed:\n${schemaResult.errors.join("\n")}`);
    }
    const checks = laneResultsToChecks([laneResult]);
    const history = await appendExecutionHistory(cwd, config, {
      featureId: feature.id,
      actor: "agent",
      summary: `Ingested lane ${laneResult.lane}: ${laneResult.decision}. ${laneResult.summary}`,
      decisions: ["Treat ingested lane-result JSON as review evidence only after schema validation."],
      alternativesRejected: ["Do not hand-edit features.json to paste review conclusions."],
      changedFiles: buildChangedFileEvidence(feature),
      impact: [`Lane ${laneResult.lane} recorded for ${feature.id}.`],
      pitfalls: [],
      errors: laneResult.status === "error" ? [{ summary: laneResult.summary }] : [],
      fixes: [],
      lessons: ["Review agents must produce provider-neutral lane-result JSON."],
      risks: laneResult.decision === "allow" ? [] : [`${laneResult.lane}: ${laneResult.summary}`],
      dynamicChecks: checks.dynamicChecks,
      staticChecks: checks.staticChecks,
      laneResults: [laneResult]
    });
    const evidence = laneResultsToEvidence([laneResult]).map((item) => ({
      ...item,
      actor: options.actor ?? item.actor
    }));
    const result = await patchFeature(cwd, config, feature.id, {
      evidence: [...(feature.evidence ?? []), ...evidence],
      history: history.summary
    });
    const payload = { featureId: feature.id, result: laneResult, evidence, history: history.summary, revision: result.revision };
    if (options.output === "json") {
      writeJson(payload);
      return;
    }
    process.stdout.write(`Ingested lane ${laneResult.lane} for ${feature.id}\n`);
    return;
  }

  const summary = await runReviewLanes(config, cwd, { feature });
  let historySummary: Feature["history"] | undefined;

  if (options.write && feature) {
    const checks = laneResultsToChecks(summary.results);
    const history = await appendExecutionHistory(cwd, config, {
      featureId: feature.id,
      actor: "agent",
      summary: summary.blocksCompletion ? "Lane runner found blocking review results." : "Lane runner completed.",
      decisions: ["Treat lane output as factual verification evidence; keep human-readable summaries in the feature inventory."],
      alternativesRejected: ["Do not let the Stop hook run long verification or LLM review work synchronously."],
      changedFiles: buildChangedFileEvidence(feature),
      impact: ["Structured lane result envelope recorded for review."],
      pitfalls: [
        {
          summary: "Stop hooks can fire at lifecycle boundaries where long-running checks are fragile.",
          prevention: "Run static, dynamic, and review lanes before the final stop attempt; let the hook aggregate persisted evidence."
        }
      ],
      errors: [],
      fixes: [],
      lessons: ["A review lane should record the command, diff/review context, findings, and decision so future agents can audit it."],
      risks: summary.results.flatMap((result) =>
        result.decision === "allow" ? [] : [`${result.lane}: ${result.summary}`]
      ),
      dynamicChecks: checks.dynamicChecks,
      staticChecks: checks.staticChecks,
      laneResults: summary.results
    });
    historySummary = history.summary;
    await patchFeature(cwd, config, feature.id, {
      evidence: [...(feature.evidence ?? []), ...laneResultsToEvidence(summary.results)],
      history: historySummary
    });
  }

  const payload = {
    ...summary,
    featureId: feature?.id,
    history: historySummary
  };

  if (options.output === "json") {
    writeJson(payload);
    return;
  }

  process.stdout.write(
    [
      `Lanes: ${summary.results.length}`,
      `Decision: ${summary.blocksCompletion ? "block" : "allow"}`,
      summary.continuationReason ?? "No blocking lane results."
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  if (process.argv.includes("--json")) {
    writeJson({
      results: [],
      blocksCompletion: true,
      error: error instanceof Error ? error.message : "Unknown lane command error"
    });
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown lane command error"}\n`);
  process.exitCode = 1;
});
