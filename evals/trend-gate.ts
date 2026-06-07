import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalReportHistoryRecord } from "./report";

export type EvalTrendGateOptions = {
  historyPath?: string;
  minRecords?: number;
  minTotalCases?: number;
  minT3Cases?: number;
  maxFailed?: number;
  maxT3Failed?: number;
  minPassRate?: number;
  minT3PassRate?: number;
  minAttemptSuccessRate?: number;
  minPassK?: number;
  maxPassKDrop?: number;
  maxAttemptSuccessDrop?: number;
  baselineWindow?: number;
};

export type EvalTrendGateCheck = {
  id: string;
  status: "pass" | "fail";
  summary: string;
  actual?: number | string;
  expected?: number | string;
};

export type EvalTrendGateBaseline = {
  records: number;
  averagePassK: number;
  attemptSuccessRate: number;
};

export type EvalTrendGateResult = {
  decision: "allow" | "block";
  historyPath: string;
  records: number;
  t3Records: number;
  latest?: EvalReportHistoryRecord;
  baseline?: EvalTrendGateBaseline;
  checks: EvalTrendGateCheck[];
};

const defaultHistoryPath = "evals/out/eval-history.jsonl";

function resolvePath(cwd: string, filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function numberOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function readHistory(filePath: string): Promise<EvalReportHistoryRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalReportHistoryRecord);
}

function checkMinimum(id: string, label: string, actual: number, expected: number): EvalTrendGateCheck {
  return {
    id,
    status: actual >= expected ? "pass" : "fail",
    actual,
    expected,
    summary:
      actual >= expected
        ? `${label} ${actual} is >= ${expected}.`
        : `${label} ${actual} is below required minimum ${expected}.`
  };
}

function checkMaximum(id: string, label: string, actual: number, expected: number): EvalTrendGateCheck {
  return {
    id,
    status: actual <= expected ? "pass" : "fail",
    actual,
    expected,
    summary:
      actual <= expected
        ? `${label} ${actual} is <= ${expected}.`
        : `${label} ${actual} exceeds allowed maximum ${expected}.`
  };
}

function checkTrendDrop(id: string, label: string, latest: number, baseline: number, maxDrop: number): EvalTrendGateCheck {
  const drop = baseline - latest;
  return {
    id,
    status: drop <= maxDrop ? "pass" : "fail",
    actual: Number(drop.toFixed(6)),
    expected: maxDrop,
    summary:
      drop <= maxDrop
        ? `${label} drop ${drop.toFixed(3)} is within ${maxDrop}.`
        : `${label} drop ${drop.toFixed(3)} exceeds ${maxDrop}.`
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baselineFor(records: EvalReportHistoryRecord[], window: number): EvalTrendGateBaseline | undefined {
  if (records.length < 2) return undefined;
  const baselineRecords = records.slice(0, -1).slice(-window);
  if (!baselineRecords.length) return undefined;
  return {
    records: baselineRecords.length,
    averagePassK: average(baselineRecords.map((record) => record.t3.averagePassK)),
    attemptSuccessRate: average(baselineRecords.map((record) => record.t3.attemptSuccessRate))
  };
}

export async function evaluateEvalTrendGate(
  options: EvalTrendGateOptions = {},
  cwd = process.cwd()
): Promise<EvalTrendGateResult> {
  const configuredPath = options.historyPath ?? defaultHistoryPath;
  const absoluteHistoryPath = resolvePath(cwd, configuredPath);
  const checks: EvalTrendGateCheck[] = [];
  let history: EvalReportHistoryRecord[];

  try {
    history = await readHistory(absoluteHistoryPath);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return {
        decision: "block",
        historyPath: configuredPath,
        records: 0,
        t3Records: 0,
        checks: [
          {
            id: "history.exists",
            status: "fail",
            expected: configuredPath,
            summary: `Eval history file ${configuredPath} does not exist. Run devns eval run with --history first.`
          }
        ]
      };
    }
    throw error;
  }

  const t3Records = history.filter((record) => record.t3?.total > 0);
  const latest = t3Records.at(-1);
  const minRecords = numberOr(options.minRecords, 1);
  const minT3Cases = numberOr(options.minT3Cases, 1);
  const maxFailed = numberOr(options.maxFailed, 0);
  const maxT3Failed = numberOr(options.maxT3Failed, 0);
  const baselineWindow = Math.max(1, Math.floor(numberOr(options.baselineWindow, 1)));

  checks.push(checkMinimum("history.records", "history records", history.length, minRecords));
  checks.push(checkMinimum("history.t3_records", "T3 history records", t3Records.length, 1));

  if (!latest) {
    checks.push({
      id: "latest.t3",
      status: "fail",
      expected: "latest T3 record",
      summary: "No T3 trend record was found in eval history."
    });
    return {
      decision: "block",
      historyPath: configuredPath,
      records: history.length,
      t3Records: t3Records.length,
      checks
    };
  }

  const baseline = baselineFor(t3Records, baselineWindow);
  const passRate = ratio(latest.passed, latest.total);
  const t3PassRate = ratio(latest.t3.passed, latest.t3.total);

  checks.push(checkMinimum("latest.t3_cases", "latest T3 cases", latest.t3.total, minT3Cases));
  checks.push(checkMaximum("latest.failed", "latest failed cases", latest.failed, maxFailed));
  checks.push(checkMaximum("latest.t3_failed", "latest T3 failed cases", latest.t3.failed, maxT3Failed));

  if (options.minTotalCases !== undefined) {
    checks.push(checkMinimum("latest.total_cases", "latest total cases", latest.total, options.minTotalCases));
  }
  if (options.minPassRate !== undefined) {
    checks.push(checkMinimum("latest.pass_rate", "latest eval pass rate", passRate, options.minPassRate));
  }
  if (options.minT3PassRate !== undefined) {
    checks.push(checkMinimum("latest.t3_pass_rate", "latest T3 eval pass rate", t3PassRate, options.minT3PassRate));
  }
  if (options.minAttemptSuccessRate !== undefined) {
    checks.push(
      checkMinimum(
        "latest.t3_attempt_success",
        "latest T3 attempt success rate",
        latest.t3.attemptSuccessRate,
        options.minAttemptSuccessRate
      )
    );
  }
  if (options.minPassK !== undefined) {
    checks.push(checkMinimum("latest.t3_pass_k", "latest T3 average pass^k", latest.t3.averagePassK, options.minPassK));
  }
  if (options.maxPassKDrop !== undefined && baseline) {
    checks.push(checkTrendDrop("trend.t3_pass_k_drop", "T3 average pass^k", latest.t3.averagePassK, baseline.averagePassK, options.maxPassKDrop));
  }
  if (options.maxAttemptSuccessDrop !== undefined && baseline) {
    checks.push(
      checkTrendDrop(
        "trend.t3_attempt_success_drop",
        "T3 attempt success",
        latest.t3.attemptSuccessRate,
        baseline.attemptSuccessRate,
        options.maxAttemptSuccessDrop
      )
    );
  }

  return {
    decision: checks.some((check) => check.status === "fail") ? "block" : "allow",
    historyPath: configuredPath,
    records: history.length,
    t3Records: t3Records.length,
    latest,
    baseline,
    checks
  };
}

export function renderEvalTrendGate(result: EvalTrendGateResult) {
  const latest = result.latest;
  return [
    `Eval trend gate: ${result.decision}`,
    `History: ${result.historyPath} (${result.records} record(s), ${result.t3Records} T3 record(s))`,
    latest
      ? `Latest: ${latest.generatedAt}; total ${latest.passed}/${latest.total}; T3 ${latest.t3.passed}/${latest.t3.total}; avg pass^k ${latest.t3.averagePassK.toFixed(3)}`
      : "Latest: none",
    result.baseline
      ? `Baseline: ${result.baseline.records} record(s); avg pass^k ${result.baseline.averagePassK.toFixed(3)}; attempt success ${result.baseline.attemptSuccessRate.toFixed(3)}`
      : "Baseline: none",
    "Checks:",
    ...result.checks.map((check) => `- ${check.status}: ${check.id}: ${check.summary}`)
  ].join("\n");
}
