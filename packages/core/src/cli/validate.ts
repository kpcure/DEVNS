#!/usr/bin/env node
import { readConfig, readInventory } from "../harness/state";
import { evaluateRfcReadiness } from "../harness/rfc";

async function main() {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);

  if (!inventory.project?.name) {
    throw new Error("Feature inventory is missing project.name");
  }

  if (!Array.isArray(inventory.features)) {
    throw new Error("Feature inventory is missing features[]");
  }

  for (const feature of inventory.features) {
    if (!feature.id || !feature.title || !feature.status || !feature.priority) {
      throw new Error(`Invalid feature record: ${JSON.stringify(feature)}`);
    }
  }

  const rfcReady = inventory.features.filter((feature) => evaluateRfcReadiness(feature).ready).length;
  const claimable = inventory.features.filter(
    (feature) => feature.status === "ready" && evaluateRfcReadiness(feature).ready
  ).length;
  const blockedReady = inventory.features.filter(
    (feature) => feature.status === "ready" && !evaluateRfcReadiness(feature).ready
  );

  process.stdout.write(
    [
      `Validated ${inventory.features.length} features for ${inventory.project.name}`,
      `RFC-ready features: ${rfcReady}`,
      `Claimable ready features: ${claimable}`
    ].join("\n") + "\n"
  );

  if (blockedReady.length > 0) {
    process.stdout.write(
      [
        `Ready features blocked by RFC gate: ${blockedReady.length}`,
        ...blockedReady.slice(0, 5).map((feature) => `- ${feature.id}: ${evaluateRfcReadiness(feature).reasons[0]}`)
      ].join("\n") + "\n"
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown validation error"}\n`);
  process.exitCode = 1;
});
