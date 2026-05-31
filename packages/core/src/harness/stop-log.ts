import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StopHookTraceEvent = {
  ts?: string;
  source: "adapter" | "core" | "cli";
  phase: string;
  cwd?: string;
  sessionId?: string;
  hookEventName?: string;
  stopHookActive?: boolean;
  decision?: "allow" | "block";
  mode?: string;
  selectedFeatureId?: string;
  activeFeatureIds?: string[];
  readyFeatureIds?: string[];
  blockedReadyFeatureIds?: string[];
  laneIds?: string[];
  featureCount?: number;
  reasons?: string[];
  reason?: string;
  command?: string;
  error?: string;
};

export function stopHookLogPath(cwd: string) {
  return path.join(cwd, ".devns", "history", "stop-hook.jsonl");
}

export async function appendStopHookTrace(cwd: string, event: StopHookTraceEvent) {
  const filePath = stopHookLogPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  const record = {
    ts: event.ts ?? new Date().toISOString(),
    ...event,
    cwd
  };
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
  return record;
}

export async function safeAppendStopHookTrace(cwd: string, event: StopHookTraceEvent) {
  try {
    await appendStopHookTrace(cwd, event);
  } catch {
    // Stop-hook diagnostics must never change the hook decision.
  }
}

export async function readStopHookTrace(cwd: string, limit = 20) {
  try {
    const raw = await readFile(stopHookLogPath(cwd), "utf8");
    const records = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StopHookTraceEvent);
    return limit > 0 ? records.slice(-limit) : records;
  } catch {
    return [];
  }
}
