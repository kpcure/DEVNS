import { access, readFile } from "node:fs/promises";
import path from "node:path";
import configSchema from "../../../../tools/schema/devns-config.schema.json";
import { validateSchema } from "./schema-validator";
import type { DevnsConfig } from "./types";
import { scanProjectExtensions, type ExtensionScanResult } from "./extensions";

export type ConfigOverrides = Partial<DevnsConfig>;

export type ConfigSource = {
  name: "built-in" | "plugin" | "project" | "extensions" | "cli";
  path?: string;
};

export type ResolvedConfig = {
  config: DevnsConfig;
  sources: ConfigSource[];
  projectConfigPath?: string;
  extensions?: ExtensionScanResult;
};

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG_NOT_FOUND" | "CONFIG_INVALID" | "CONFIG_READ_FAILED"
  ) {
    super(message);
  }
}

export const defaultConfig: DevnsConfig = {
  version: 1,
  features: ".devns/features.json",
  candidates: ".devns/candidates.json",
  rfcs: ".devns/rfcs",
  history: ".devns/history",
  policies: ".devns/policies",
  review: {
    mode: "html",
    outputDir: ".devns/workbench"
  },
  completionPolicy: {
    mode: "queue",
    whenNoActiveFeature: "claim_next",
    whenNoClaimableFeature: "allow_stop",
    requireApprovedRfc: true,
    requireEvidence: true,
    requireReviewDecision: true,
    requireCleanWorktree: false,
    requireCommit: true,
    allowEmptyOutputWhenComplete: true
  },
  skills: {
    init: "devns-init",
    rfc: "devns-rfc",
    run: "devns-run"
  },
  hooks: {
    stop: {
      mode: "gate",
      retryBudget: 3,
      defaultDecision: "stop_for_human_review",
      blockOn: {
        missingApprovedRfc: true,
        skippedRequiredVerification: true,
        outOfScopeFiles: true
      }
    }
  },
  reviewLanes: []
};

const projectConfigCandidates = [
  path.join(".devns", "devns.config.json"),
  "devns.config.json"
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig<T extends Record<string, unknown>>(base: T, override?: Record<string, unknown>): T {
  if (!override) {
    return structuredClone(base);
  }

  const merged = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeConfig(existing, value);
    } else if (value !== undefined) {
      merged[key] = structuredClone(value);
    }
  }
  return merged as T;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readConfigFile(filePath: string): Promise<DevnsConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Unable to read DEVNS config at ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`,
      "CONFIG_READ_FAILED"
    );
  }

  try {
    return JSON.parse(raw) as DevnsConfig;
  } catch (error) {
    throw new ConfigError(
      `Invalid JSON in DEVNS config at ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`,
      "CONFIG_INVALID"
    );
  }
}

export function validateConfig(config: DevnsConfig, source = "DEVNS config") {
  const result = validateSchema(config, configSchema);
  if (!result.valid) {
    throw new ConfigError(`${source} schema validation failed:\n${result.errors.join("\n")}`, "CONFIG_INVALID");
  }
}

export async function findProjectConfig(cwd: string) {
  for (const candidate of projectConfigCandidates) {
    const configPath = path.join(cwd, candidate);
    if (await fileExists(configPath)) {
      return configPath;
    }
  }
  return undefined;
}

export async function loadConfig(
  cwd = process.cwd(),
  options: {
    pluginDefaults?: ConfigOverrides;
    overrides?: ConfigOverrides;
    configPath?: string;
  } = {}
): Promise<ResolvedConfig> {
  const sources: ConfigSource[] = [{ name: "built-in" }];
  let config = structuredClone(defaultConfig);

  if (options.pluginDefaults) {
    config = mergeConfig(config as unknown as Record<string, unknown>, options.pluginDefaults as Record<string, unknown>) as DevnsConfig;
    sources.push({ name: "plugin" });
  }

  const projectConfigPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : await findProjectConfig(cwd);
  if (projectConfigPath) {
    const projectConfig = await readConfigFile(projectConfigPath);
    config = mergeConfig(config as unknown as Record<string, unknown>, projectConfig as unknown as Record<string, unknown>) as DevnsConfig;
    sources.push({ name: "project", path: projectConfigPath });
  }

  const extensions = await scanProjectExtensions(cwd);
  if (Object.values(extensions.files).some((files) => Object.keys(files).length > 0)) {
    config = mergeConfig(config as unknown as Record<string, unknown>, extensions.configPatch as Record<string, unknown>) as DevnsConfig;
    sources.push({ name: "extensions", path: path.join(cwd, ".devns") });
  }

  if (options.overrides) {
    config = mergeConfig(config as unknown as Record<string, unknown>, options.overrides as Record<string, unknown>) as DevnsConfig;
    sources.push({ name: "cli" });
  }

  validateConfig(config, "Resolved DEVNS config");
  return { config, sources, projectConfigPath, extensions };
}
