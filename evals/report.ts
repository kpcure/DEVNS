import type { EvalCaseOutcome } from "./harness";
import type { EvalModeMetrics } from "./metrics";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderEvalReport(input: {
  generatedAt: string;
  outcomes: EvalCaseOutcome[];
  metrics: {
    total: number;
    passed: number;
    failed: number;
    perMode: EvalModeMetrics[];
  };
}) {
  return [
    "# DEVNS Eval Report",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Cases: ${input.metrics.total}`,
    `- Passed: ${input.metrics.passed}`,
    `- Failed: ${input.metrics.failed}`,
    "",
    "## Per-Mode Metrics",
    "",
    "| Mode | Total | Pass | TP | FP | FN | TN | Precision | Recall | F1 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.metrics.perMode.map(
      (metric) =>
        `| ${metric.mode} | ${metric.total} | ${metric.passed} | ${metric.tp} | ${metric.fp} | ${metric.fn} | ${metric.tn} | ${pct(metric.precision)} | ${pct(metric.recall)} | ${pct(metric.f1)} |`
    ),
    "",
    "## Cases",
    "",
    "| Case | Mode | Expected | Actual | Result | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...input.outcomes.map(
      (outcome) =>
        `| ${outcome.id} | ${outcome.mode} | ${outcome.expected} | ${outcome.actual} | ${outcome.pass ? "pass" : "fail"} | ${outcome.reason.replaceAll("|", "\\|")} |`
    ),
    ""
  ].join("\n");
}
