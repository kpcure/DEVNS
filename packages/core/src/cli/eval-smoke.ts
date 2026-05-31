#!/usr/bin/env node
import { runEval } from "../../../../evals/runner";

async function main() {
  const result = await runEval({ tier: "t1" });
  if (result.metrics.failed > 0) {
    throw new Error(`Eval smoke failed: ${result.metrics.failed}/${result.metrics.total} case(s) failed.`);
  }
  process.stdout.write("Eval smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown eval smoke error"}\n`);
  process.exitCode = 1;
});
