#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRfcScaffold, evaluateRfcReadiness } from "../harness/rfc";
import { readCandidates, readConfig, readInventory, resolveFromCwd } from "../harness/state";
import type { CandidateFeature } from "../harness/types";

type RfcCommand = "scaffold" | "check";

type RfcOptions = {
  command?: RfcCommand;
  id?: string;
  output?: "json" | "text";
  force: boolean;
};

function parseArgs(argv: string[]): RfcOptions {
  const options: RfcOptions = {
    command: argv[0] as RfcCommand | undefined,
    output: "text",
    force: false
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") {
      options.id = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--force") {
      options.force = true;
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run devns:rfc -- scaffold --id <candidate-or-feature-id>",
      "  npm run devns:rfc -- check --id <feature-id> [--json]"
    ].join("\n") + "\n"
  );
}

function findCandidate(candidates: CandidateFeature[], id: string) {
  return candidates.find((candidate) => candidate.id === id);
}

async function scaffoldRfc(cwd: string, id: string, force: boolean) {
  const config = await readConfig(cwd);
  const candidates = await readCandidates(cwd, config);
  const inventory = await readInventory(cwd, config);
  const candidate = findCandidate(candidates.candidates, id);
  const feature = inventory.features.find((item) => item.id === id);
  const source = candidate ?? feature;

  if (!source) {
    throw new Error(`Unable to find candidate or feature ${id}`);
  }

  const rfcDir = resolveFromCwd(cwd, config.rfcs ?? ".devns/rfcs");
  await mkdir(rfcDir, { recursive: true });

  const rfc = createRfcScaffold(source);
  const outPath = path.join(rfcDir, `${id}.json`);

  await writeFile(outPath, `${JSON.stringify({ $schema: "../../tools/schema/rfc.schema.json", id, title: source.title, rfc }, null, 2)}\n`, {
    flag: force ? "w" : "wx"
  });

  process.stdout.write(`Created RFC scaffold at ${path.relative(cwd, outPath)}\n`);
}

async function checkRfc(cwd: string, id: string, output: "json" | "text") {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = inventory.features.find((item) => item.id === id);

  if (!feature) {
    throw new Error(`Unable to find feature ${id}`);
  }

  const readiness = evaluateRfcReadiness(feature);
  if (output === "json") {
    process.stdout.write(`${JSON.stringify({ id, ...readiness }, null, 2)}\n`);
    return;
  }

  if (readiness.ready) {
    process.stdout.write(`Feature ${id} has a claimable RFC.\n`);
    return;
  }

  process.stdout.write([`Feature ${id} RFC is not claimable.`, ...readiness.reasons.map((reason) => `- ${reason}`)].join("\n") + "\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (!options.command || !["scaffold", "check"].includes(options.command) || !options.id) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.command === "scaffold") {
    await scaffoldRfc(cwd, options.id, options.force);
    return;
  }

  await checkRfc(cwd, options.id, options.output ?? "text");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown RFC command error"}\n`);
  process.exitCode = 1;
});
