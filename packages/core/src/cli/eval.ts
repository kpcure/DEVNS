#!/usr/bin/env node
import { runEval, type EvalRunOptions } from "../../../../evals/runner";
import type { EvalTier } from "../../../../evals/harness";

type Options = EvalRunOptions & {
  command?: "run";
  output: "text" | "json";
};

function parseArgs(argv: string[]): Options {
  const options: Options = { command: argv[0] as "run" | undefined, output: "text" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tier") {
      options.tier = argv[index + 1] as EvalTier;
      index += 1;
    } else if (arg === "--mode") {
      options.mode = argv[index + 1];
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--report") {
      options.reportPath = argv[index + 1];
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
      "  devns eval run --tier t1 [--mode M3_fake_evidence] [--json]",
      "  devns eval run --all --report evals/out/report.md",
      "",
      "T1 deterministic gate evals and T2 frozen review-result golden checks run locally. T3 cases are reserved for nightly workflows."
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "run") {
    usage();
    process.exitCode = 1;
    return;
  }

  const result = await runEval(options);
  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `Eval cases: ${result.metrics.total}`,
        `Passed: ${result.metrics.passed}`,
        `Failed: ${result.metrics.failed}`,
        ...(result.reportPath ? [`Report: ${result.reportPath}`] : [])
      ].join("\n") + "\n"
    );
  }

  if (result.metrics.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown eval command error" }, null, 2)}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown eval command error"}\n`);
  process.exitCode = 1;
});
