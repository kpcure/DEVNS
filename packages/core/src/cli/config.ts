#!/usr/bin/env node
import { loadConfig } from "../harness/config";

type ConfigCommand = "inspect";

type ConfigOptions = {
  command?: ConfigCommand;
  json: boolean;
};

function parseArgs(argv: string[]): ConfigOptions {
  return {
    command: argv[0] as ConfigCommand | undefined,
    json: argv.includes("--json")
  };
}

function printUsage() {
  process.stdout.write(["Usage:", "  npm run devns:config -- inspect [--json]"].join("\n") + "\n");
}

async function inspect(options: ConfigOptions) {
  const resolved = await loadConfig(process.cwd());
  if (options.json) {
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    return;
  }

  const extensionFiles = resolved.extensions?.files;
  process.stdout.write(
    [
      "DEVNS config",
      `Sources: ${resolved.sources.map((source) => source.name).join(" < ")}`,
      `Features: ${resolved.config.features}`,
      `Skills: ${Object.keys(resolved.config.skills ?? {}).join(", ") || "none"}`,
      `Agents: ${Object.keys(resolved.config.agents ?? {}).join(", ") || "none"}`,
      `Policies: ${Object.keys(extensionFiles?.policies ?? {}).join(", ") || "none"}`,
      `Lanes: ${Object.keys(extensionFiles?.lanes ?? {}).join(", ") || "none"}`,
      `Sensors: ${Object.keys(resolved.config.sensors ?? {}).join(", ") || "none"}`
    ].join("\n") + "\n"
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== "inspect") {
    printUsage();
    process.exitCode = 1;
    return;
  }
  await inspect(options);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown config command error"}\n`);
  process.exitCode = 1;
});
