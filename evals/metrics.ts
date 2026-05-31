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

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1(precision: number, recall: number) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function isPositive(decision: EvalDecision) {
  return decision === "blocked";
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
    perMode
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
