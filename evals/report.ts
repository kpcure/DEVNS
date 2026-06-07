import type { EvalCaseOutcome } from "./harness";
import type { EvalModeMetrics } from "./metrics";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function metadataSummary(value?: Record<string, unknown>) {
  if (!value) return "";
  const t3 = value.t3 as
    | {
        projectType?: string;
        riskArea?: string;
        attempts?: number;
        successes?: number;
        k?: number;
        passK?: number;
        elapsedMs?: number;
        estimatedCostUsd?: number;
        failureTaxonomy?: string[];
      }
    | undefined;
  if (!t3) return JSON.stringify(value).replaceAll("|", "\\|");
  return [
    `type=${t3.projectType ?? "unknown"}`,
    `risk=${t3.riskArea ?? "unknown"}`,
    `attempts=${t3.attempts ?? 0}`,
    `successes=${t3.successes ?? 0}`,
    `pass^${t3.k ?? 1}=${typeof t3.passK === "number" ? t3.passK.toFixed(3) : "n/a"}`,
    `elapsedMs=${t3.elapsedMs ?? 0}`,
    `costUsd=${typeof t3.estimatedCostUsd === "number" ? t3.estimatedCostUsd.toFixed(4) : "0.0000"}`,
    `failures=${(t3.failureTaxonomy ?? []).join(",") || "none"}`
  ].join("; ");
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
    "| Case | Mode | Expected | Actual | Result | Reason | Metadata |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...input.outcomes.map(
      (outcome) =>
        `| ${outcome.id} | ${outcome.mode} | ${outcome.expected} | ${outcome.actual} | ${outcome.pass ? "pass" : "fail"} | ${outcome.reason.replaceAll("|", "\\|")} | ${metadataSummary(outcome.metadata)} |`
    ),
    ""
  ].join("\n");
}
