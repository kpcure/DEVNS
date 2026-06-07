import type { EvalCaseOutcome, EvalDecision } from "./harness";

export type EvalModeMetrics = {
  mode: string;
  total: number;
  passed: number;
  failed: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
};

export type EvalT3GroupMetrics = {
  label: string;
  total: number;
  passed: number;
  failed: number;
  actualAllowed: number;
  actualBlocked: number;
  attempts: number;
  successfulAttempts: number;
  attemptSuccessRate: number;
  averagePassK: number;
  elapsedMs: number;
  estimatedCostUsd: number;
  failureTaxonomy: Record<string, number>;
};

export type EvalT3Metrics = Omit<EvalT3GroupMetrics, "label"> & {
  byProjectType: EvalT3GroupMetrics[];
  byRiskArea: EvalT3GroupMetrics[];
};

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1(precision: number, recall: number) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function isPositive(decision: EvalDecision) {
  return decision === "blocked";
}

type T3Metadata = {
  projectType?: string;
  riskArea?: string;
  attempts?: number;
  successes?: number;
  passK?: number;
  elapsedMs?: number;
  estimatedCostUsd?: number;
  failureTaxonomy?: string[];
};

function t3Metadata(outcome: EvalCaseOutcome): T3Metadata | undefined {
  const t3 = outcome.metadata?.t3;
  return typeof t3 === "object" && t3 !== null ? (t3 as T3Metadata) : undefined;
}

function sortGroups(groups: Map<string, EvalCaseOutcome[]>) {
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function t3GroupMetrics(label: string, outcomes: EvalCaseOutcome[]): EvalT3GroupMetrics {
  const metadata = outcomes.map(t3Metadata).filter((item): item is T3Metadata => Boolean(item));
  const attempts = metadata.reduce((sum, item) => sum + (item.attempts ?? 0), 0);
  const successfulAttempts = metadata.reduce((sum, item) => sum + (item.successes ?? 0), 0);
  const passKValues = metadata.map((item) => item.passK).filter((value): value is number => typeof value === "number");
  const failureTaxonomy: Record<string, number> = {};

  for (const item of metadata) {
    for (const failureClass of item.failureTaxonomy ?? []) {
      if (failureClass === "none") continue;
      failureTaxonomy[failureClass] = (failureTaxonomy[failureClass] ?? 0) + 1;
    }
  }

  return {
    label,
    total: outcomes.length,
    passed: outcomes.filter((item) => item.pass).length,
    failed: outcomes.filter((item) => !item.pass).length,
    actualAllowed: outcomes.filter((item) => item.actual === "allowed").length,
    actualBlocked: outcomes.filter((item) => item.actual === "blocked").length,
    attempts,
    successfulAttempts,
    attemptSuccessRate: ratio(successfulAttempts, attempts),
    averagePassK: ratio(passKValues.reduce((sum, value) => sum + value, 0), passKValues.length),
    elapsedMs: metadata.reduce((sum, item) => sum + (item.elapsedMs ?? 0), 0),
    estimatedCostUsd: metadata.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0),
    failureTaxonomy
  };
}

function groupT3(outcomes: EvalCaseOutcome[], key: (metadata: T3Metadata) => string) {
  const groups = new Map<string, EvalCaseOutcome[]>();
  for (const outcome of outcomes) {
    const metadata = t3Metadata(outcome);
    if (!metadata) continue;
    const label = key(metadata) || "unknown";
    groups.set(label, [...(groups.get(label) ?? []), outcome]);
  }
  return sortGroups(groups).map(([label, items]) => t3GroupMetrics(label, items));
}

function t3MetricsForOutcomes(outcomes: EvalCaseOutcome[]): EvalT3Metrics {
  const t3Outcomes = outcomes.filter((outcome) => t3Metadata(outcome));
  const total = t3GroupMetrics("all", t3Outcomes);
  return {
    total: total.total,
    passed: total.passed,
    failed: total.failed,
    actualAllowed: total.actualAllowed,
    actualBlocked: total.actualBlocked,
    attempts: total.attempts,
    successfulAttempts: total.successfulAttempts,
    attemptSuccessRate: total.attemptSuccessRate,
    averagePassK: total.averagePassK,
    elapsedMs: total.elapsedMs,
    estimatedCostUsd: total.estimatedCostUsd,
    failureTaxonomy: total.failureTaxonomy,
    byProjectType: groupT3(t3Outcomes, (metadata) => metadata.projectType ?? "unknown"),
    byRiskArea: groupT3(t3Outcomes, (metadata) => metadata.riskArea ?? "unknown")
  };
}

export function metricsForOutcomes(outcomes: EvalCaseOutcome[]) {
  const modes = new Map<string, EvalCaseOutcome[]>();
  for (const outcome of outcomes) {
    modes.set(outcome.mode, [...(modes.get(outcome.mode) ?? []), outcome]);
  }

  const perMode = [...modes.entries()].map(([mode, items]): EvalModeMetrics => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    for (const item of items) {
      const expectedPositive = isPositive(item.expected);
      const actualPositive = isPositive(item.actual);
      if (expectedPositive && actualPositive) tp += 1;
      else if (!expectedPositive && actualPositive) fp += 1;
      else if (expectedPositive && !actualPositive) fn += 1;
      else tn += 1;
    }
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    return {
      mode,
      total: items.length,
      passed: items.filter((item) => item.pass).length,
      failed: items.filter((item) => !item.pass).length,
      tp,
      fp,
      fn,
      tn,
      precision,
      recall,
      f1: f1(precision, recall)
    };
  });

  return {
    total: outcomes.length,
    passed: outcomes.filter((item) => item.pass).length,
    failed: outcomes.filter((item) => !item.pass).length,
    perMode,
    t3: t3MetricsForOutcomes(outcomes)
  };
}

function combinations(n: number, k: number) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - i + 1)) / i;
  }
  return result;
}

export function passK(successes: number, trials: number, k: number) {
  const denominator = combinations(trials, k);
  return denominator === 0 ? 0 : combinations(successes, k) / denominator;
}
