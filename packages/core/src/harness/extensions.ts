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
    entries = await readdir(dir);
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

async function loadLaneDefinitions(cwd: string, lanes: Record<string, string>): Promise<NonNullable<DevnsConfig["reviewLanes"]>> {
  const definitions: NonNullable<DevnsConfig["reviewLanes"]> = [];
  for (const [id, relativePath] of Object.entries(lanes)) {
    const raw = await readFile(path.join(cwd, relativePath), "utf8");
    const parsed = JSON.parse(raw) as NonNullable<DevnsConfig["reviewLanes"]>[number];
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

  const configPatch: Partial<DevnsConfig> = {
    extensions: files
  };

  if (Object.keys(files.skills).length > 0) {
    configPatch.skills = files.skills;
  }
  if (Object.keys(files.sensors).length > 0) {
    configPatch.sensors = files.sensors;
  }
  if (Object.keys(files.lanes).length > 0) {
    configPatch.reviewLanes = await loadLaneDefinitions(cwd, files.lanes);
  }

  return { configPatch, files };
}
