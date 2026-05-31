#!/usr/bin/env node
import { writeMorningReviewReport } from "../harness/morning-review";
import { writeReviewPacket } from "../harness/review-packet";

type Options = {
  command?: "generate" | "packet";
  date?: string;
  featureId?: string;
  format?: "json" | "prompt";
  write?: boolean;
  maxBytes?: number;
  commit?: string;
  base?: string;
  output: "text" | "json";
};

function parseArgs(argv: string[]): Options {
  const options: Options = { command: argv[0] as Options["command"], output: "text" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      options.date = argv[index + 1];
      index += 1;
    } else if (arg === "--feature" || arg === "--id") {
      options.featureId = argv[index + 1];
      index += 1;
    } else if (arg === "--format") {
      options.format = argv[index + 1] === "prompt" ? "prompt" : "json";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--max-bytes") {
      options.maxBytes = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--commit") {
      options.commit = argv[index + 1];
      index += 1;
    } else if (arg === "--base") {
      options.base = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      options.output = "json";
      options.format = "json";
    }
  }
  return options;
}

function usage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run devns:review -- generate [--date YYYY-MM-DD] [--json]",
      "  npm run devns:review -- packet [--feature <id>] [--commit <sha>] [--base <sha>] [--format json|prompt] [--write] [--json]"
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "packet") {
    const result = await writeReviewPacket(process.cwd(), {
      featureId: options.featureId,
      format: options.format ?? "json",
      write: options.write,
      maxBytes: options.maxBytes,
      commit: options.commit,
      base: options.base
    });
    if (options.output === "json") {
      process.stdout.write(`${JSON.stringify({ packet: result.packet, jsonPath: result.jsonPath, promptPath: result.promptPath }, null, 2)}\n`);
      return;
    }
    if (!options.write) {
      process.stdout.write(`${result.rendered}\n`);
      return;
    }
    process.stdout.write(
      [
        `Review packet: ${result.packet.feature.id}`,
        `JSON: ${result.jsonPath}`,
        options.format === "prompt" ? `Prompt: ${result.promptPath}` : undefined
      ]
        .filter(Boolean)
        .join("\n") + "\n"
    );
    return;
  }

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
