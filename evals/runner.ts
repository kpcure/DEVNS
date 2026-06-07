import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEvalCases, runT1Case, runT2Case, runT3Case, type EvalTier } from "./harness";
import { metricsForOutcomes } from "./metrics";
import { renderEvalReport, type EvalReportHistoryRecord } from "./report";

export type EvalRunOptions = {
  tier?: EvalTier;
  mode?: string;
  all?: boolean;
  reportPath?: string;
  historyPath?: string;
};

function resolveOutputPath(cwd: string, outputPath: string) {
  return path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath);
}

async function readEvalHistory(historyPath: string): Promise<EvalReportHistoryRecord[]> {
  try {
    const content = await readFile(historyPath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvalReportHistoryRecord);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
}

async function appendEvalHistory(historyPath: string, record: EvalReportHistoryRecord) {
  await mkdir(path.dirname(historyPath), { recursive: true });
  const previous = await readEvalHistory(historyPath);
  await appendFile(historyPath, `${JSON.stringify(record)}\n`);
  return [...previous, record].slice(-20);
}

export async function runEval(options: EvalRunOptions = {}, cwd = process.cwd()) {
  const tier = options.all || (options.mode && !options.tier) ? undefined : options.tier ?? "t1";
  const casesRoot = path.join(cwd, "evals/cases");
  const cases = (await loadEvalCases(casesRoot)).filter((testCase) => {
    if (tier && testCase.tier !== tier) return false;
    if (options.mode && testCase.mode !== options.mode) return false;
    return true;
  });

  const outcomes = [];
  for (const testCase of cases) {
    if (testCase.tier === "t1") {
      outcomes.push(await runT1Case(testCase));
      continue;
    }

    if (testCase.tier === "t2") {
      outcomes.push(await runT2Case(testCase));
      continue;
    }

    outcomes.push(await runT3Case(testCase, cwd));
  }

  const metrics = metricsForOutcomes(outcomes);
  const generatedAt = new Date().toISOString();
  const historyRecord: EvalReportHistoryRecord = {
    generatedAt,
    total: metrics.total,
    passed: metrics.passed,
    failed: metrics.failed,
    t3: metrics.t3
  };
  const absoluteHistoryPath = options.historyPath ? resolveOutputPath(cwd, options.historyPath) : undefined;
  const history = absoluteHistoryPath ? await appendEvalHistory(absoluteHistoryPath, historyRecord) : undefined;
  const report = renderEvalReport({ generatedAt, outcomes, metrics, history });

  if (options.reportPath) {
    const absoluteReportPath = resolveOutputPath(cwd, options.reportPath);
    await mkdir(path.dirname(absoluteReportPath), { recursive: true });
    await writeFile(absoluteReportPath, `${report}\n`);
  }

  return {
    generatedAt,
    options,
    metrics,
    outcomes,
    reportPath: options.reportPath,
    historyPath: options.historyPath,
    history
  };
}
