import { canClaimFeature } from "./rfc";
import {
  FeatureStoreError,
  findActiveFeature,
  findBlockedReadyFeature,
  findNextReadyFeature,
  patchFeature,
  readInventory
} from "./state";
import type { Evidence, Feature, FeatureEvent, DevnsConfig } from "./types";

export class TaskQueueError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ACTIVE_FEATURE_EXISTS"
      | "FEATURE_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "MISSING_EVIDENCE"
      | "RFC_GATE_BLOCKED"
  ) {
    super(message);
  }
}

type QueueOptions = {
  by?: string;
  summary?: string;
  expectedRevision?: string;
};

function event(type: FeatureEvent["type"], summary: string, by?: string): FeatureEvent {
  return {
    type,
    at: new Date().toISOString(),
    by,
    summary
  };
}

function appendEvent(feature: Feature, nextEvent: FeatureEvent) {
  return [...(feature.events ?? []), nextEvent];
}

function findFeature(features: Feature[], featureId: string) {
  return features.find((feature) => feature.id === featureId);
}

function ensureFeature(features: Feature[], featureId: string) {
  const feature = findFeature(features, featureId);
  if (!feature) {
    throw new TaskQueueError(`Feature ${featureId} not found`, "FEATURE_NOT_FOUND");
  }
  return feature;
}

export async function nextFeature(cwd: string, config: DevnsConfig) {
  const inventory = await readInventory(cwd, config);
  return findNextReadyFeature(inventory.features);
}

export async function blockedReadyFeature(cwd: string, config: DevnsConfig) {
  const inventory = await readInventory(cwd, config);
  return findBlockedReadyFeature(inventory.features);
}

export async function activeFeature(cwd: string, config: DevnsConfig) {
  const inventory = await readInventory(cwd, config);
  return findActiveFeature(inventory.features);
}

export async function claimFeature(cwd: string, config: DevnsConfig, featureId?: string, options: QueueOptions = {}) {
  const inventory = await readInventory(cwd, config);
  const active = findActiveFeature(inventory.features);
  if (active) {
    throw new TaskQueueError(`Feature ${active.id} is already in progress`, "ACTIVE_FEATURE_EXISTS");
  }

  const feature = featureId ? ensureFeature(inventory.features, featureId) : findNextReadyFeature(inventory.features);
  if (!feature) {
    return undefined;
  }

  const readiness = canClaimFeature(feature);
  if (!readiness.ready) {
    throw new TaskQueueError(
      [`Feature ${feature.id} cannot be claimed.`, ...readiness.reasons.map((reason) => `- ${reason}`)].join("\n"),
      "RFC_GATE_BLOCKED"
    );
  }

  return patchFeature(
    cwd,
    config,
    feature.id,
    {
      status: "in_progress",
      agentNotes: `${feature.agentNotes || ""}`.trim(),
      events: appendEvent(feature, event("claimed", options.summary ?? `Claimed ${feature.id}`, options.by))
    },
    { expectedRevision: options.expectedRevision }
  );
}

export async function releaseFeature(cwd: string, config: DevnsConfig, featureId: string, options: QueueOptions = {}) {
  const inventory = await readInventory(cwd, config);
  const feature = ensureFeature(inventory.features, featureId);
  if (feature.status !== "in_progress") {
    throw new TaskQueueError(`Feature ${feature.id} is ${feature.status}, not in_progress`, "INVALID_TRANSITION");
  }

  return patchFeature(cwd, config, feature.id, {
    status: "ready",
    events: appendEvent(feature, event("released", options.summary ?? `Released ${feature.id}`, options.by))
  });
}

export async function blockFeature(
  cwd: string,
  config: DevnsConfig,
  featureId: string,
  reason: string,
  options: QueueOptions = {}
) {
  const inventory = await readInventory(cwd, config);
  const feature = ensureFeature(inventory.features, featureId);

  if (feature.status === "done") {
    throw new TaskQueueError(`Feature ${feature.id} is done and cannot be blocked`, "INVALID_TRANSITION");
  }

  return patchFeature(cwd, config, feature.id, {
    status: "blocked",
    agentNotes: [feature.agentNotes, `Blocked: ${reason}`].filter(Boolean).join("\n"),
    events: appendEvent(feature, event("blocked", reason, options.by))
  });
}

export async function failFeature(
  cwd: string,
  config: DevnsConfig,
  featureId: string,
  reason: string,
  options: QueueOptions = {}
) {
  const inventory = await readInventory(cwd, config);
  const feature = ensureFeature(inventory.features, featureId);

  if (feature.status === "done") {
    throw new TaskQueueError(`Feature ${feature.id} is done and cannot be failed`, "INVALID_TRANSITION");
  }

  return patchFeature(cwd, config, feature.id, {
    status: "failed",
    agentNotes: [feature.agentNotes, `Failed: ${reason}`].filter(Boolean).join("\n"),
    events: appendEvent(feature, event("failed", reason, options.by))
  });
}

export async function completeFeature(
  cwd: string,
  config: DevnsConfig,
  featureId: string,
  evidence: Evidence[],
  options: QueueOptions = {}
) {
  const inventory = await readInventory(cwd, config);
  const feature = ensureFeature(inventory.features, featureId);

  if (feature.status !== "in_progress") {
    throw new TaskQueueError(`Feature ${feature.id} is ${feature.status}, not in_progress`, "INVALID_TRANSITION");
  }

  if (!evidence.length && !(feature.evidence?.length ?? 0)) {
    throw new TaskQueueError(`Feature ${feature.id} cannot complete without evidence`, "MISSING_EVIDENCE");
  }

  return patchFeature(cwd, config, feature.id, {
    status: "done",
    evidence: [...(feature.evidence ?? []), ...evidence],
    events: appendEvent(feature, event("completed", options.summary ?? `Completed ${feature.id}`, options.by))
  });
}

export function isFeatureStoreNotFound(error: unknown) {
  return error instanceof FeatureStoreError && error.code === "FEATURE_NOT_FOUND";
}
