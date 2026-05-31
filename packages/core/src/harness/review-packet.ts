import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { evaluateEvidenceQuality, type EvidenceQualityReport } from "./evidence-quality";
import { historyPathForFeature, readExecutionHistoryRecords } from "./history";
import { readConfig, readInventory, resolveFromCwd } from "./state";
import type { DevnsConfig, ExecutionHistoryRecord, Feature } from "./types";

const execFileAsync = promisify(execFile);

export type ReviewPacket = {
  schemaVersion: 1;
  generatedAt: string;
  feature: Pick<
    Feature,
    | "id"
    | "title"
    | "description"
    | "status"
    | "priority"
    | "risk"
    | "acceptanceCriteria"
    | "changedFiles"
    | "commit"
    | "implementationCommit"
    | "metadataCommit"
    | "reviewDecision"
    | "agentNotes"
  >;
  rfc?: Feature["rfc"];
  git: {
    base?: string;
    head?: string;
    status: string;
    diff: string;
    truncated: boolean;
  };
  evidenceQuality: EvidenceQualityReport;
  evidence: Feature["evidence"];
  history: ExecutionHistoryRecord[];
  projectRules: Array<{
    path: string;
    content: string;
    truncated: boolean;
  }>;
  reviewInstructions: string[];
};

export type WriteReviewPacketOptions = {
  featureId?: string;
  format?: "json" | "prompt";
  write?: boolean;
  maxBytes?: number;
};

async function git(cwd: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function trimToBytes(value: string, maxBytes: number) {
  const bytes = Buffer.byteLength(value);
  if (bytes <= maxBytes) {
    return { value, truncated: false };
  }
  const suffix = "\n... truncated by DEVNS review packet budget ...";
  return {
    value: Buffer.from(value).subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix))).toString("utf8") + suffix,
    truncated: true
  };
}

function packetOutputDir(cwd: string, config: DevnsConfig) {
  const configured = config.review?.outputDir ?? ".devns/reviews";
  return path.join(resolveFromCwd(cwd, configured), "packets");
}

function selectedFeature(features: Feature[], featureId?: string) {
  if (featureId) return features.find((feature) => feature.id === featureId);
  return features.find((feature) => feature.status === "in_progress") ?? features.find((feature) => feature.status === "done");
}

async function readProjectRules(cwd: string, maxBytes: number) {
  const candidates = ["AGENTS.md", ".devns/index.md", ".devns/project.md", ".devns/policies/default.md"];
  const rules: ReviewPacket["projectRules"] = [];
  for (const relativePath of candidates) {
    try {
      const raw = await readFile(path.join(cwd, relativePath), "utf8");
      const trimmed = trimToBytes(raw, maxBytes);
      rules.push({ path: relativePath, content: trimmed.value, truncated: trimmed.truncated });
    } catch {
      // Optional local rule files are absent in many projects.
    }
  }
  return rules;
}

async function historyFor(cwd: string, config: DevnsConfig, feature: Feature) {
  const filePath = feature.history?.historyPath ? resolveFromCwd(cwd, feature.history.historyPath) : historyPathForFeature(cwd, config, feature.id);
  return readExecutionHistoryRecords(filePath);
}

export async function buildReviewPacket(cwd: string, config: DevnsConfig, feature: Feature, maxBytes = 120_000): Promise<ReviewPacket> {
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const base = feature.implementationCommit ?? feature.commit;
  const diffArgs = base ? ["show", "--format=", "--find-renames", base] : ["diff", "--find-renames", "HEAD", "--"];
  const rawDiff = await git(cwd, diffArgs);
  const diff = trimToBytes(rawDiff, Math.floor(maxBytes * 0.6));
  const status = await git(cwd, ["status", "--short"]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    feature: {
      id: feature.id,
      title: feature.title,
      description: feature.description,
      status: feature.status,
      priority: feature.priority,
      risk: feature.risk,
      acceptanceCriteria: feature.acceptanceCriteria,
      changedFiles: feature.changedFiles,
      commit: feature.commit,
      implementationCommit: feature.implementationCommit,
      metadataCommit: feature.metadataCommit,
      reviewDecision: feature.reviewDecision,
      agentNotes: feature.agentNotes
    },
    rfc: feature.rfc,
    git: {
      base,
      head,
      status,
      diff: diff.value,
      truncated: diff.truncated
    },
    evidenceQuality: evaluateEvidenceQuality(feature),
    evidence: feature.evidence ?? [],
    history: await historyFor(cwd, config, feature),
    projectRules: await readProjectRules(cwd, Math.floor(maxBytes * 0.15)),
    reviewInstructions: [
      "Act as a read-only code review agent.",
      "Prioritize correctness, security, requirements drift, missing tests, and evidence gaps.",
      "Do not edit files, install dependencies, create commits, or rewrite DEVNS state.",
      "Return findings ordered by severity with file and line references when available."
    ]
  };
}

export function renderReviewPacketPrompt(packet: ReviewPacket) {
  return [
    "# DEVNS Review Agent Packet",
    "",
    "You are reviewing one completed feature. Stay read-only and report findings only.",
    "",
    "## Instructions",
    ...packet.reviewInstructions.map((item) => `- ${item}`),
    "",
    "## Feature",
    JSON.stringify(packet.feature, null, 2),
    "",
    "## RFC",
    JSON.stringify(packet.rfc ?? null, null, 2),
    "",
    "## Evidence Quality",
    JSON.stringify(packet.evidenceQuality, null, 2),
    "",
    "## Git Status",
    "```text",
    packet.git.status || "clean",
    "```",
    "",
    "## Diff",
    "```diff",
    packet.git.diff || "No diff available.",
    "```",
    "",
    "## History",
    JSON.stringify(packet.history, null, 2),
    "",
    "## Project Rules",
    JSON.stringify(packet.projectRules, null, 2)
  ].join("\n");
}

export async function writeReviewPacket(cwd: string, options: WriteReviewPacketOptions = {}) {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const feature = selectedFeature(inventory.features, options.featureId);
  if (!feature) {
    throw new Error(options.featureId ? `Feature ${options.featureId} not found.` : "No active or completed feature found.");
  }

  const packet = await buildReviewPacket(cwd, config, feature, options.maxBytes);
  const outputDir = packetOutputDir(cwd, config);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${feature.id}.review-packet.json`);
  const promptPath = path.join(outputDir, `${feature.id}.review-prompt.md`);

  if (options.write) {
    await writeFile(jsonPath, `${JSON.stringify(packet, null, 2)}\n`);
    if (options.format === "prompt") {
      await writeFile(promptPath, `${renderReviewPacketPrompt(packet)}\n`);
    }
  }

  return {
    packet,
    jsonPath: path.relative(cwd, jsonPath),
    promptPath: path.relative(cwd, promptPath),
    rendered: options.format === "prompt" ? renderReviewPacketPrompt(packet) : JSON.stringify(packet, null, 2)
  };
}
