import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DevnsConfig } from "./types";

export type ExtensionKind = "skills" | "agents" | "policies" | "lanes" | "sensors";

export type ExtensionScanResult = {
  configPatch: Partial<DevnsConfig>;
  files: Record<ExtensionKind, Record<string, string>>;
};

const extensionDirs: Record<ExtensionKind, string> = {
  skills: ".devns/skills",
  agents: ".devns/agents",
  policies: ".devns/policies",
  lanes: ".devns/lanes",
  sensors: ".devns/sensors"
};

const extensionNames: Record<ExtensionKind, string[]> = {
  skills: [".md", ".json"],
  agents: [".json"],
  policies: [".json"],
  lanes: [".json"],
  sensors: [".js", ".mjs", ".sh"]
};

function extensionId(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

async function scanDir(cwd: string, kind: ExtensionKind) {
  const dir = path.join(cwd, extensionDirs[kind]);
  let entries: string[];
  try {
    entries = (await readdir(dir)).sort((a, b) => a.localeCompare(b));
  } catch {
    return {};
  }

  const allowedExtensions = extensionNames[kind];
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!allowedExtensions.some((extension) => entry.endsWith(extension))) {
      continue;
    }
    files[extensionId(entry)] = path.join(extensionDirs[kind], entry);
  }
  return files;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObject<T extends Record<string, unknown>>(base: T, override?: Record<string, unknown>): T {
  if (!override) {
    return structuredClone(base);
  }

  const merged = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeObject(existing, value);
    } else if (value !== undefined) {
      merged[key] = structuredClone(value);
    }
  }
  return merged as T;
}

async function readJsonExtension(cwd: string, relativePath: string) {
  const raw = await readFile(path.join(cwd, relativePath), "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON extension at ${relativePath}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function loadAgentDefinitions(cwd: string, agents: Record<string, string>): Promise<Record<string, unknown>> {
  const definitions: Record<string, unknown> = {};
  for (const [id, relativePath] of Object.entries(agents)) {
    const parsed = await readJsonExtension(cwd, relativePath);
    if (!isPlainObject(parsed)) {
      throw new Error(`Agent extension ${relativePath} must be a JSON object.`);
    }
    definitions[id] = parsed;
  }
  return definitions;
}

async function loadPolicyPatches(cwd: string, policies: Record<string, string>): Promise<Partial<DevnsConfig>> {
  let patch: Record<string, unknown> = {};
  for (const [, relativePath] of Object.entries(policies)) {
    const parsed = await readJsonExtension(cwd, relativePath);
    if (!isPlainObject(parsed)) {
      throw new Error(`Policy extension ${relativePath} must be a DEVNS config patch object.`);
    }
    patch = mergeObject(patch, parsed);
  }
  return patch as Partial<DevnsConfig>;
}

function mergeReviewLanes(
  base: NonNullable<DevnsConfig["reviewLanes"]> = [],
  override: NonNullable<DevnsConfig["reviewLanes"]> = []
) {
  const byId = new Map(base.map((lane) => [lane.id, lane]));
  for (const lane of override) {
    byId.set(lane.id, { ...byId.get(lane.id), ...lane });
  }
  return [...byId.values()];
}

async function loadLaneDefinitions(cwd: string, lanes: Record<string, string>): Promise<NonNullable<DevnsConfig["reviewLanes"]>> {
  const definitions: NonNullable<DevnsConfig["reviewLanes"]> = [];
  for (const [id, relativePath] of Object.entries(lanes)) {
    const parsed = await readJsonExtension(cwd, relativePath) as NonNullable<DevnsConfig["reviewLanes"]>[number];
    if (!isPlainObject(parsed)) {
      throw new Error(`Lane extension ${relativePath} must be a JSON object.`);
    }
    definitions.push({ ...parsed, type: parsed.type ?? "builtin", id: parsed.id ?? id });
  }
  return definitions;
}

export async function scanProjectExtensions(cwd: string): Promise<ExtensionScanResult> {
  const files = {
    skills: await scanDir(cwd, "skills"),
    agents: await scanDir(cwd, "agents"),
    policies: await scanDir(cwd, "policies"),
    lanes: await scanDir(cwd, "lanes"),
    sensors: await scanDir(cwd, "sensors")
  };

  const policyPatch = await loadPolicyPatches(cwd, files.policies);
  const configPatch = mergeObject({} as Record<string, unknown>, policyPatch as Record<string, unknown>) as Partial<DevnsConfig>;

  configPatch.extensions = mergeObject(
    isPlainObject(configPatch.extensions) ? configPatch.extensions : {},
    files
  ) as DevnsConfig["extensions"];

  if (Object.keys(files.skills).length > 0) {
    configPatch.skills = files.skills;
  }
  if (Object.keys(files.agents).length > 0) {
    const agentDefinitions = await loadAgentDefinitions(cwd, files.agents);
    configPatch.agents = mergeObject(
      isPlainObject(configPatch.agents) ? configPatch.agents : {},
      agentDefinitions
    );
  }
  if (Object.keys(files.sensors).length > 0) {
    configPatch.sensors = files.sensors;
  }
  if (Object.keys(files.lanes).length > 0) {
    const policyReviewLanes = Array.isArray(configPatch.reviewLanes) ? configPatch.reviewLanes : [];
    configPatch.reviewLanes = mergeReviewLanes(policyReviewLanes, await loadLaneDefinitions(cwd, files.lanes));
  }

  return { configPatch, files };
}
