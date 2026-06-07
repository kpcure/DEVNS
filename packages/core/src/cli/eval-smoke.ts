#!/usr/bin/env node
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runEval } from "../../../../evals/runner";
import { evaluateEvalTrendGate } from "../../../../evals/trend-gate";

async function main() {
  const t1 = await runEval({ tier: "t1" });
  const t2 = await runEval({ tier: "t2" });
  const t3 = await runEval({ tier: "t3" });
  const modeLookup = await runEval({ mode: "M18_review_packet_quality" });
  const failed = t1.metrics.failed + t2.metrics.failed + t3.metrics.failed + modeLookup.metrics.failed;
  const total = t1.metrics.total + t2.metrics.total + t3.metrics.total + modeLookup.metrics.total;
  if (modeLookup.metrics.total !== 2) {
    throw new Error(`Eval smoke expected mode lookup to find 2 M18 cases, got ${modeLookup.metrics.total}.`);
  }
  if (t3.metrics.total !== 8) {
    throw new Error(`Eval smoke expected T3 to run 8 multi-shape seed repository cases, got ${t3.metrics.total}.`);
  }
  if (t3.metrics.t3.total !== 8 || t3.metrics.t3.byProjectType.length < 4 || t3.metrics.t3.byRiskArea.length < 3) {
    throw new Error("Eval smoke expected T3 metrics to include project type and risk-area aggregation.");
  }
  const hostInitMode = t1.metrics.perMode.find((metric) => metric.mode === "M24_host_adapter_init");
  if (!hostInitMode || hostInitMode.total !== 4 || hostInitMode.failed !== 0) {
    throw new Error("Eval smoke expected M24 host adapter init evals to run 4 passing clean/trap cases.");
  }
  if (failed > 0) {
    throw new Error(`Eval smoke failed: ${failed}/${total} case(s) failed.`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "devns-eval-smoke-"));
  try {
    const reportPath = path.join(tempDir, "report.md");
    const historyPath = path.join(tempDir, "history.jsonl");
    await runEval({ tier: "t3", reportPath, historyPath });
    const report = await readFile(reportPath, "utf8");
    const history = await readFile(historyPath, "utf8");
    if (!report.includes("## T3 Seed Summary") || !report.includes("## Recent T3 Trend")) {
      throw new Error("Eval smoke expected generated report to include T3 summary and trend sections.");
    }
    if (!history.includes("\"total\":8") || !history.includes("\"byProjectType\"")) {
      throw new Error("Eval smoke expected history JSONL to include T3 aggregate metrics.");
    }
    const healthyGate = await evaluateEvalTrendGate({
      historyPath,
      minT3Cases: 8,
      minT3PassRate: 1,
      minPassK: 0.5,
      maxPassKDrop: 0
    });
    if (healthyGate.decision !== "allow") {
      throw new Error(`Eval smoke expected healthy trend gate to allow, got ${healthyGate.decision}.`);
    }

    const records = history
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const latest = records.at(-1);
    const degraded = {
      ...latest,
      generatedAt: "2026-06-07T00:00:00.000Z",
      passed: latest.passed - 1,
      failed: latest.failed + 1,
      t3: {
        ...latest.t3,
        passed: latest.t3.passed - 1,
        failed: latest.t3.failed + 1,
        averagePassK: 0.25
      }
    };
    await appendFile(historyPath, `${JSON.stringify(degraded)}\n`);
    const degradedGate = await evaluateEvalTrendGate({
      historyPath,
      minT3Cases: 8,
      minT3PassRate: 1,
      minPassK: 0.5,
      maxPassKDrop: 0
    });
    if (
      degradedGate.decision !== "block" ||
      !degradedGate.checks.some((check) => check.id === "trend.t3_pass_k_drop" && check.status === "fail")
    ) {
      throw new Error("Eval smoke expected degraded trend gate to block on pass^k regression.");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  process.stdout.write("Eval smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown eval smoke error"}\n`);
  process.exitCode = 1;
});
