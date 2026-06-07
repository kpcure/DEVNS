#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runEval } from "../../../../evals/runner";

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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  process.stdout.write("Eval smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown eval smoke error"}\n`);
  process.exitCode = 1;
});
