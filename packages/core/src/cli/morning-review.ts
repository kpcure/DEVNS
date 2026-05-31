#!/usr/bin/env node
import { writeMorningReviewReport } from "../harness/morning-review";

type Options = {
  command?: "generate";
  date?: string;
  output: "text" | "json";
};

function parseArgs(argv: string[]): Options {
  const options: Options = { command: argv[0] as Options["command"], output: "text" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      options.date = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
    }
  }
  return options;
}

function usage() {
  process.stdout.write("Usage:\n  npm run devns:review -- generate [--date YYYY-MM-DD] [--json]\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "generate") {
    usage();
    process.exitCode = 1;
    return;
  }

  const result = await writeMorningReviewReport(process.cwd(), options.date);
  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `Morning review: ${result.report.date}`,
      `Features: ${result.report.summary.featureCount}`,
      `Needs human review: ${result.report.summary.needsHumanReview}`,
      `JSON: ${result.jsonPath}`,
      `Markdown: ${result.markdownPath}`
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown morning review error"}\n`);
  process.exitCode = 1;
});
