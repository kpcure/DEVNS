import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import featuresSchema from "../../../../tools/schema/features.schema.json";
import type { CandidateInventory, Feature, FeatureInventory, FeaturePatch, NeverStopConfig } from "./types";
import { canClaimFeature } from "./rfc";
import { validateSchema } from "./schema-validator";
import { loadConfig } from "./config";

const editableFeatureFields = new Set([
  "status",
  "priority",
  "risk",
  "reviewDecision",
  "agentNotes",
  "evidence",
  "changedFiles",
  "commit",
  "review",
  "rfc",
  "events"
]);

export class FeatureStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "SCHEMA_INVALID" | "REVISION_CONFLICT" | "FEATURE_NOT_FOUND" | "PATCH_FIELD_DENIED"
  ) {
    super(message);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function computeRevision(value: unknown) {
  const withoutRevision = structuredClone(value) as { revision?: string };
  delete withoutRevision.revision;
  return createHash("sha256").update(JSON.stringify(withoutRevision)).digest("hex").slice(0, 16);
}

function withRevision<T extends { revision?: string }>(value: T): T {
  value.revision = computeRevision(value);
  return value;
}

export function validateFeatureInventory(inventory: FeatureInventory) {
  const result = validateSchema(inventory, featuresSchema);
  if (!result.valid) {
    throw new FeatureStoreError(`Feature inventory schema validation failed:\n${result.errors.join("\n")}`, "SCHEMA_INVALID");
  }
}

export async function readConfig(cwd: string): Promise<NeverStopConfig> {
  return (await loadConfig(cwd)).config;
}

export function resolveFromCwd(cwd: string, maybeRelativePath: string) {
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.join(cwd, maybeRelativePath);
}

export async function readInventory(cwd: string, config: NeverStopConfig) {
  const inventory = await readJsonFile<FeatureInventory>(resolveFromCwd(cwd, config.features));
  validateFeatureInventory(inventory);
  return inventory;
}

export async function writeInventory(cwd: string, config: NeverStopConfig, inventory: FeatureInventory) {
  validateFeatureInventory(inventory);
  withRevision(inventory);
  validateFeatureInventory(inventory);
  await writeJsonFile(resolveFromCwd(cwd, config.features), inventory);
}

export async function readCandidates(cwd: string, config: NeverStopConfig) {
  if (!config.candidates) {
    return { candidates: [] } satisfies CandidateInventory;
  }

  return readJsonFile<CandidateInventory>(resolveFromCwd(cwd, config.candidates));
}

export async function loadInventory(cwd = process.cwd()) {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  return { config, inventory, revision: inventory.revision ?? computeRevision(inventory) };
}

export async function saveInventory(
  cwd: string,
  config: NeverStopConfig,
  inventory: FeatureInventory,
  options: { expectedRevision?: string } = {}
) {
  const current = await readInventory(cwd, config);
  const currentRevision = current.revision ?? computeRevision(current);

  if (options.expectedRevision && options.expectedRevision !== currentRevision) {
    throw new FeatureStoreError(
      `Feature inventory revision conflict: expected ${options.expectedRevision}, current ${currentRevision}`,
      "REVISION_CONFLICT"
    );
  }

  await writeInventory(cwd, config, inventory);
  return inventory.revision ?? computeRevision(inventory);
}

export async function patchFeature(
  cwd: string,
  config: NeverStopConfig,
  featureId: string,
  patch: FeaturePatch,
  options: { expectedRevision?: string } = {}
) {
  for (const field of Object.keys(patch)) {
    if (!editableFeatureFields.has(field)) {
      throw new FeatureStoreError(`Patch field ${field} is not editable through patchFeature`, "PATCH_FIELD_DENIED");
    }
  }

  const inventory = await readInventory(cwd, config);
  const currentRevision = inventory.revision ?? computeRevision(inventory);

  if (options.expectedRevision && options.expectedRevision !== currentRevision) {
    throw new FeatureStoreError(
      `Feature inventory revision conflict: expected ${options.expectedRevision}, current ${currentRevision}`,
      "REVISION_CONFLICT"
    );
  }

  const feature = inventory.features.find((item) => item.id === featureId);
  if (!feature) {
    throw new FeatureStoreError(`Feature ${featureId} not found`, "FEATURE_NOT_FOUND");
  }

  Object.assign(feature, patch);
  await writeInventory(cwd, config, inventory);
  return { feature, inventory, revision: inventory.revision ?? computeRevision(inventory) };
}

export function findActiveFeature(features: Feature[]) {
  return features.find((feature) => feature.status === "in_progress");
}

export function findNextReadyFeature(features: Feature[]) {
  const priorityRank = new Map([
    ["P0", 0],
    ["P1", 1],
    ["P2", 2],
    ["P3", 3]
  ]);

  return [...features]
    .filter((feature) => canClaimFeature(feature).ready)
    .sort((a, b) => {
      const priority = (priorityRank.get(a.priority) ?? 99) - (priorityRank.get(b.priority) ?? 99);
      return priority || a.id.localeCompare(b.id);
    })[0];
}

export function findBlockedReadyFeature(features: Feature[]) {
  return [...features]
    .filter((feature) => feature.status === "ready")
    .map((feature) => ({ feature, readiness: canClaimFeature(feature) }))
    .find((item) => !item.readiness.ready);
}
