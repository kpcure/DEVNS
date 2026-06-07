import path from "node:path";
import { historyPathForFeature, readExecutionHistoryRecords } from "./history";
import { readStopHookTrace } from "./stop-log";
import type { DevnsConfig, Feature } from "./types";

export type ContextBudgetCounts = {
  historyRecordCount?: number;
  continuationTurnCount?: number;
};

export type ContextBudgetReport = {
  policy: NonNullable<NonNullable<DevnsConfig["completionPolicy"]>["contextBudget"]>;
  historyRecordCount: number;
  continuationTurnCount: number;
  preferFreshWorker: boolean;
  resetRecommended: boolean;
  compactHandoffRecommended: boolean;
  handoffTokenBudget?: number;
  reasons: string[];
  instruction: string;
};

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function configuredPolicy(config: DevnsConfig): ContextBudgetReport["policy"] {
  return config.completionPolicy?.contextBudget ?? {};
}

export function evaluateContextBudgetFromCounts(
  config: DevnsConfig,
  _feature: Feature,
  counts: ContextBudgetCounts = {}
): ContextBudgetReport {
  const policy = configuredPolicy(config);
  const historyRecordCount = Math.max(0, counts.historyRecordCount ?? 0);
  const continuationTurnCount = Math.max(0, counts.continuationTurnCount ?? 0);
  const historyLimit = positiveNumber(policy.resetWhenHistoryRecordsExceed);
  const continuationLimit = positiveNumber(policy.maxContinuationTurns);
  const handoffTokenBudget = positiveNumber(policy.handoffTokenBudget);
  const preferFreshWorker = policy.preferFreshWorkerPerFeature !== false;
  const historyExceeded = historyLimit !== undefined && historyRecordCount > historyLimit;
  const continuationExceeded = continuationLimit !== undefined && continuationTurnCount >= continuationLimit;
  const resetRecommended = historyExceeded || continuationExceeded;
  const compactHandoffRecommended = resetRecommended || preferFreshWorker;
  const reasons = [
    preferFreshWorker ? "Policy prefers a fresh worker or isolated implementation context per feature." : "",
    historyExceeded
      ? `Feature history has ${historyRecordCount} record(s), exceeding resetWhenHistoryRecordsExceed=${historyLimit}.`
      : "",
    continuationExceeded
      ? `Stop-hook continuation count is ${continuationTurnCount}, meeting maxContinuationTurns=${continuationLimit}.`
      : "",
    handoffTokenBudget ? `Use a bounded handoff target of about ${handoffTokenBudget} token(s).` : ""
  ].filter(Boolean);
  const instruction = compactHandoffRecommended
    ? [
        resetRecommended
          ? "Context budget recommends resetting to a fresh worker or compact implementation context before more edits."
          : "Context budget prefers a fresh worker or isolated implementation context for this feature.",
        "Read the approved RFC, feature record, latest history, and review/lane evidence from disk; do not rely on the current conversation transcript as the source of truth.",
        handoffTokenBudget ? `Keep the next handoff around ${handoffTokenBudget} token(s) and link detailed history/artifacts instead of pasting them.` : ""
      ]
        .filter(Boolean)
        .join(" ")
    : "Context budget does not require a fresh worker yet.";

  return {
    policy,
    historyRecordCount,
    continuationTurnCount,
    preferFreshWorker,
    resetRecommended,
    compactHandoffRecommended,
    handoffTokenBudget,
    reasons,
    instruction
  };
}

export async function evaluateContextBudget(cwd: string, config: DevnsConfig, feature: Feature): Promise<ContextBudgetReport> {
  const historyPath = feature.history?.historyPath ?? historyPathForFeature(cwd, config, feature.id);
  const records = await readExecutionHistoryRecords(path.isAbsolute(historyPath) ? historyPath : path.resolve(cwd, historyPath));
  const stopRecords = await readStopHookTrace(cwd, 0);
  const continuationTurnCount = stopRecords.filter(
    (record) =>
      record.source === "core" &&
      record.decision === "block" &&
      record.selectedFeatureId === feature.id &&
      (record.mode === "active_block" || record.mode === "claim_next_block")
  ).length;
  return evaluateContextBudgetFromCounts(config, feature, {
    historyRecordCount: Math.max(feature.history?.recordCount ?? 0, records.length),
    continuationTurnCount
  });
}
