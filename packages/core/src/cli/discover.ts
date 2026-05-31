#!/usr/bin/env node
import { readConfig } from "../harness/state";
import { writeDiscoveredCandidates } from "../harness/discovery";

type DiscoverOptions = {
  output: "json" | "text";
  force: boolean;
};

function parseArgs(argv: string[]): DiscoverOptions {
  return {
    output: argv.includes("--json") ? "json" : "text",
    force: argv.includes("--force")
  };
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  const result = await writeDiscoveredCandidates(cwd, config, { force: options.force });

  if (options.output === "json") {
    writeJson({
      created: result.candidates.length,
      candidates: result.candidates,
      notes: result.notes
    });
    return;
  }

  if (!result.candidates.length) {
    process.stdout.write("No new candidates discovered.\n");
    return;
  }

  process.stdout.write(
    [
      `Discovered ${result.candidates.length} candidate(s):`,
      ...result.candidates.map((candidate) => `- ${candidate.id} ${candidate.title} (${candidate.confidence ?? "unknown"} confidence)`)
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown discovery error"}\n`);
  process.exitCode = 1;
});
