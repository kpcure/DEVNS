#!/usr/bin/env node
import { runEval, type EvalRunOptions } from "../../../../evals/runner";
import type { EvalTier } from "../../../../evals/harness";
import { evaluateEvalTrendGate, renderEvalTrendGate, type EvalTrendGateOptions } from "../../../../evals/trend-gate";

type Options = EvalRunOptions &
  EvalTrendGateOptions & {
  command?: "run" | "gate";
  output: "text" | "json";
};

function parseArgs(argv: string[]): Options {
  const options: Options = { command: argv[0] as "run" | "gate" | undefined, output: "text" };
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
    } else if (arg === "--history") {
      options.historyPath = argv[index + 1];
      index += 1;
    } else if (arg === "--min-records") {
      options.minRecords = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-total-cases") {
      options.minTotalCases = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-t3-cases") {
      options.minT3Cases = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--max-failed") {
      options.maxFailed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--max-t3-failed") {
      options.maxT3Failed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-pass-rate") {
      options.minPassRate = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-t3-pass-rate") {
      options.minT3PassRate = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-attempt-success-rate") {
      options.minAttemptSuccessRate = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--min-pass-k") {
      options.minPassK = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--max-pass-k-drop") {
      options.maxPassKDrop = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--max-attempt-success-drop") {
      options.maxAttemptSuccessDrop = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--baseline-window") {
      options.baselineWindow = Number(argv[index + 1]);
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
      "  devns eval run --tier t2 [--mode M18_review_packet_quality] [--json]",
      "  devns eval run --mode M18_review_packet_quality [--json]",
      "  devns eval run --tier t3 [--json]",
      "  devns eval run --all --report evals/out/report.md [--history evals/out/eval-history.jsonl]",
      "  devns eval gate --history evals/out/eval-history.jsonl [--min-t3-cases 8] [--min-t3-pass-rate 1] [--max-pass-k-drop 0] [--json]",
      "",
      "T1 deterministic gate evals, T2 frozen review-result/review-packet golden checks, and T3 local seed repositories run locally. Use --history to append JSONL trend records for generated reports, then eval gate to enforce release/nightly trend thresholds."
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "run" && options.command !== "gate") {
    usage();
    process.exitCode = 1;
    return;
  }

  if (options.command === "gate") {
    const result = await evaluateEvalTrendGate(options);
    if (options.output === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${renderEvalTrendGate(result)}\n`);
    }
    if (result.decision === "block") {
      process.exitCode = 1;
    }
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
        ...(result.reportPath ? [`Report: ${result.reportPath}`] : []),
        ...(result.historyPath ? [`History: ${result.historyPath}`] : [])
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
