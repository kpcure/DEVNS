import { readdir } from "node:fs/promises";
import path from "node:path";
import type { NeverStopConfig } from "./types";

export type ExtensionKind = "skills" | "agents" | "policies" | "lanes" | "sensors";

export type ExtensionScanResult = {
  configPatch: Partial<NeverStopConfig>;
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

export async function scanProjectExtensions(cwd: string): Promise<ExtensionScanResult> {
  const files = {
    skills: await scanDir(cwd, "skills"),
    agents: await scanDir(cwd, "agents"),
    policies: await scanDir(cwd, "policies"),
    lanes: await scanDir(cwd, "lanes"),
    sensors: await scanDir(cwd, "sensors")
  };

  const configPatch: Partial<NeverStopConfig> = {
    extensions: files
  };

  if (Object.keys(files.skills).length > 0) {
    configPatch.skills = files.skills;
  }
  if (Object.keys(files.sensors).length > 0) {
    configPatch.sensors = files.sensors;
  }

  return { configPatch, files };
}
