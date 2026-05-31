#!/usr/bin/env node
import { runHarnessValidation, type ValidationCheck } from "../harness/validate";

type Options = {
  output: "text" | "json";
  strict: boolean;
  fix: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    output: "text",
    strict: false,
    fix: false
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--fix") {
      options.fix = true;
    }
  }

  return options;
}

function icon(status: ValidationCheck["status"]) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runHarnessValidation(process.cwd(), options);

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `Harness validation: ${report.status}`,
        `Checks: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
        report.fixed.length ? `Fixed: ${report.fixed.join(", ")}` : "",
        "",
        ...report.checks
          .filter((check) => check.status !== "pass")
          .map((check) =>
            [
              `${icon(check.status)} ${check.id}: ${check.summary}`,
              ...(check.details?.length ? check.details.map((detail) => `  - ${detail}`) : []),
              check.suggestedFix ? `  Fix: ${check.suggestedFix}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          )
      ]
        .filter(Boolean)
        .join("\n") + "\n"
    );
  }

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown validation error"}\n`);
  process.exitCode = 1;
});
