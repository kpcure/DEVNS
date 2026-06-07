#!/usr/bin/env node
import { runEval } from "../../../../evals/runner";

async function main() {
  const t1 = await runEval({ tier: "t1" });
  const t2 = await runEval({ tier: "t2" });
  const modeLookup = await runEval({ mode: "M18_review_packet_quality" });
  const failed = t1.metrics.failed + t2.metrics.failed + modeLookup.metrics.failed;
  const total = t1.metrics.total + t2.metrics.total + modeLookup.metrics.total;
  if (modeLookup.metrics.total !== 2) {
    throw new Error(`Eval smoke expected mode lookup to find 2 M18 cases, got ${modeLookup.metrics.total}.`);
  }
  if (failed > 0) {
    throw new Error(`Eval smoke failed: ${failed}/${total} case(s) failed.`);
  }
  process.stdout.write("Eval smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown eval smoke error"}\n`);
  process.exitCode = 1;
});
