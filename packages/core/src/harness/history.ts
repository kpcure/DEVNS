import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChangedFileEvidence, CheckRecord, ExecutionHistoryRecord, Feature, HumanChangeNote, DevnsConfig } from "./types";
import type { LaneResult } from "./lane-runner";

type CuratedHistoryFields =
  | "decisions"
  | "alternativesRejected"
  | "pitfalls"
  | "errors"
  | "fixes"
  | "lessons";

export type AppendHistoryInput = Omit<ExecutionHistoryRecord, "id" | "attempt" | "createdAt" | CuratedHistoryFields> &
  Partial<Pick<ExecutionHistoryRecord, CuratedHistoryFields>> & {
  id?: string;
  createdAt?: string;
  attempt?: number;
};

function safeFeatureId(featureId: string) {
  return featureId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function historyPathForFeature(cwd: string, config: DevnsConfig, featureId: string) {
  const historyDir = config.history ?? ".devns/history";
  const resolvedHistoryDir = path.isAbsolute(historyDir) ? historyDir : path.join(cwd, historyDir);
  return path.join(resolvedHistoryDir, `${safeFeatureId(featureId)}.jsonl`);
}

export async function readExecutionHistoryRecords(filePath: string): Promise<ExecutionHistoryRecord[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ExecutionHistoryRecord);
  } catch {
    return [];
  }
}

export async function appendExecutionHistory(cwd: string, config: DevnsConfig, input: AppendHistoryInput) {
  const filePath = historyPathForFeature(cwd, config, input.featureId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const previous = await readExecutionHistoryRecords(filePath);
  const attempt = input.attempt ?? previous.length + 1;
  const createdAt = input.createdAt ?? new Date().toISOString();
  const record: ExecutionHistoryRecord = {
    ...input,
    id: input.id ?? `${input.featureId}-${attempt}`,
    attempt,
    createdAt,
    decisions: input.decisions ?? [],
    alternativesRejected: input.alternativesRejected ?? [],
    pitfalls: input.pitfalls ?? [],
    errors: input.errors ?? [],
    fixes: input.fixes ?? [],
    lessons: input.lessons ?? []
  };
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
  return {
    record,
    summary: {
      latestRecord: record.id,
      latestSummary: record.summary,
      recordCount: previous.length + 1,
      historyPath: path.relative(cwd, filePath)
    }
  };
}

export function laneResultsToChecks(results: LaneResult[]) {
  const dynamicChecks: CheckRecord[] = [];
  const staticChecks: CheckRecord[] = [];

  for (const result of results) {
    const check: CheckRecord = {
      type: result.type === "command" ? "dynamic" : "static",
      name: result.lane,
      status: result.status === "pass" ? "passed" : result.status === "skipped" ? "skipped" : "failed",
      summary: result.summary,
      exitCode: result.exitCode
    };
    if (result.type === "command") {
      dynamicChecks.push(check);
    } else {
      staticChecks.push(check);
    }
  }

  return { dynamicChecks, staticChecks };
}

export function buildChangedFileEvidence(feature: Feature, reasons: Record<string, string> = {}): ChangedFileEvidence[] {
  return (feature.changedFiles ?? []).map((file) => ({
    path: file,
    reason: reasons[file] ?? "Changed as part of the feature implementation.",
    acceptanceCriteria: feature.acceptanceCriteria
  }));
}

export function buildHumanChangeRecord(featureId: string, note: HumanChangeNote): AppendHistoryInput {
  return {
    featureId,
    actor: "human",
    summary: note.summary,
    changedFiles: [],
    impact: ["Feature state or metadata was changed by a human."],
    risks: [],
    dynamicChecks: [],
    staticChecks: [],
    humanChange: note
  };
}
