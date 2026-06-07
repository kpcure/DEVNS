import type { EvalCaseOutcome } from "./harness";
import type { EvalModeMetrics, EvalT3GroupMetrics, EvalT3Metrics } from "./metrics";

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function usd(value: number) {
  return value.toFixed(4);
}

function cell(value: string) {
  return value.replaceAll("\n", " ").replaceAll("|", "\\|");
}

function failureSummary(value: Record<string, number>) {
  const entries = Object.entries(value).sort(([, left], [, right]) => right - left);
  return entries.length ? entries.map(([name, count]) => `${name}:${count}`).join(", ") : "none";
}

function metadataSummary(value?: Record<string, unknown>) {
  if (!value) return "";
  const t3 = value.t3 as
    | {
        projectType?: string;
        riskArea?: string;
        attempts?: number;
        successes?: number;
        commandSuccesses?: number;
        artifactPassed?: boolean;
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
    `commandSuccesses=${t3.commandSuccesses ?? t3.successes ?? 0}`,
    `artifactPassed=${t3.artifactPassed === undefined ? "unknown" : String(t3.artifactPassed)}`,
    `pass^${t3.k ?? 1}=${typeof t3.passK === "number" ? t3.passK.toFixed(3) : "n/a"}`,
    `elapsedMs=${t3.elapsedMs ?? 0}`,
    `costUsd=${typeof t3.estimatedCostUsd === "number" ? t3.estimatedCostUsd.toFixed(4) : "0.0000"}`,
    `failures=${(t3.failureTaxonomy ?? []).join(",") || "none"}`
  ].join("; ");
}

function t3GroupRows(groups: EvalT3GroupMetrics[]) {
  return groups.map(
    (group) =>
      `| ${cell(group.label)} | ${group.total} | ${group.passed}/${group.total} | ${group.actualAllowed} | ${group.actualBlocked} | ${group.successfulAttempts}/${group.attempts} | ${pct(group.attemptSuccessRate)} | ${group.averagePassK.toFixed(3)} | ${group.elapsedMs} | ${usd(group.estimatedCostUsd)} | ${cell(failureSummary(group.failureTaxonomy))} |`
  );
}

function t3SummarySection(t3: EvalT3Metrics) {
  if (t3.total === 0) return [];
  return [
    "",
    "## T3 Seed Summary",
    "",
    `- T3 cases: ${t3.total}`,
    `- Eval pass: ${t3.passed}/${t3.total}`,
    `- Actual decisions: ${t3.actualAllowed} allowed, ${t3.actualBlocked} blocked`,
    `- Attempts: ${t3.successfulAttempts}/${t3.attempts} successful (${pct(t3.attemptSuccessRate)})`,
    `- Average pass^k: ${t3.averagePassK.toFixed(3)}`,
    `- Elapsed: ${t3.elapsedMs} ms`,
    `- Estimated cost: $${usd(t3.estimatedCostUsd)}`,
    `- Failure taxonomy: ${failureSummary(t3.failureTaxonomy)}`,
    "",
    "### T3 By Project Type",
    "",
    "| Project Type | Cases | Eval Pass | Actual Allow | Actual Block | Attempts | Attempt Success | Avg pass^k | Elapsed ms | Cost USD | Failures |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...t3GroupRows(t3.byProjectType),
    "",
    "### T3 By Risk Area",
    "",
    "| Risk Area | Cases | Eval Pass | Actual Allow | Actual Block | Attempts | Attempt Success | Avg pass^k | Elapsed ms | Cost USD | Failures |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...t3GroupRows(t3.byRiskArea)
  ];
}

export type EvalReportHistoryRecord = {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  t3: EvalT3Metrics;
};

function t3TrendSection(history: EvalReportHistoryRecord[] = []) {
  const records = history.filter((record) => record.t3.total > 0).slice(-10);
  if (records.length === 0) return [];
  return [
    "",
    "## Recent T3 Trend",
    "",
    "| Generated | Cases | Eval Pass | Attempt Success | Avg pass^k | Elapsed ms | Cost USD | Failures |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...records.map(
      (record) =>
        `| ${record.generatedAt} | ${record.t3.total} | ${record.t3.passed}/${record.t3.total} | ${record.t3.successfulAttempts}/${record.t3.attempts} (${pct(record.t3.attemptSuccessRate)}) | ${record.t3.averagePassK.toFixed(3)} | ${record.t3.elapsedMs} | ${usd(record.t3.estimatedCostUsd)} | ${cell(failureSummary(record.t3.failureTaxonomy))} |`
    )
  ];
}

export function renderEvalReport(input: {
  generatedAt: string;
  outcomes: EvalCaseOutcome[];
  metrics: {
    total: number;
    passed: number;
    failed: number;
    perMode: EvalModeMetrics[];
    t3: EvalT3Metrics;
  };
  history?: EvalReportHistoryRecord[];
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
    ...t3SummarySection(input.metrics.t3),
    ...t3TrendSection(input.history),
    "",
    "## Cases",
    "",
    "| Case | Mode | Expected | Actual | Result | Reason | Metadata |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...input.outcomes.map(
      (outcome) =>
        `| ${outcome.id} | ${outcome.mode} | ${outcome.expected} | ${outcome.actual} | ${outcome.pass ? "pass" : "fail"} | ${cell(outcome.reason)} | ${cell(metadataSummary(outcome.metadata))} |`
    ),
    ""
  ].join("\n");
}
