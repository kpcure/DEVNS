import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEvalCases, runT1Case, type EvalTier } from "./harness";
import { metricsForOutcomes } from "./metrics";
import { renderEvalReport } from "./report";

export type EvalRunOptions = {
  tier?: EvalTier;
  mode?: string;
  all?: boolean;
  reportPath?: string;
};

export async function runEval(options: EvalRunOptions = {}, cwd = process.cwd()) {
  const tier = options.all ? undefined : options.tier ?? "t1";
  const casesRoot = path.join(cwd, "evals/cases");
  const cases = (await loadEvalCases(casesRoot)).filter((testCase) => {
    if (tier && testCase.tier !== tier) return false;
    if (options.mode && testCase.mode !== options.mode) return false;
    return true;
  });

  const outcomes = [];
  for (const testCase of cases) {
    if (testCase.tier !== "t1") {
      outcomes.push({
        id: testCase.id,
        tier: testCase.tier,
        mode: testCase.mode,
        expected: testCase.expect.decision,
        actual: "blocked" as const,
        reason: "Only T1 deterministic eval execution is implemented in this runner.",
        pass: false
      });
      continue;
    }
    outcomes.push(await runT1Case(testCase));
  }

  const metrics = metricsForOutcomes(outcomes);
  const generatedAt = new Date().toISOString();
  const report = renderEvalReport({ generatedAt, outcomes, metrics });

  if (options.reportPath) {
    const absoluteReportPath = path.isAbsolute(options.reportPath)
      ? options.reportPath
      : path.join(cwd, options.reportPath);
    await mkdir(path.dirname(absoluteReportPath), { recursive: true });
    await writeFile(absoluteReportPath, `${report}\n`);
  }

  return {
    generatedAt,
    options,
    metrics,
    outcomes,
    reportPath: options.reportPath
  };
}
