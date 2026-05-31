#!/usr/bin/env node
import { appendExecutionHistory, buildChangedFileEvidence, laneResultsToChecks } from "../harness/history";
import { laneResultsToEvidence, runReviewLanes } from "../harness/lane-runner";
import { patchFeature, readConfig, readInventory } from "../harness/state";
import type { Feature } from "../harness/types";

type LaneCommand = "run";

type LaneOptions = {
  command?: LaneCommand;
  featureId?: string;
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
  if (options.command !== "run") {
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
