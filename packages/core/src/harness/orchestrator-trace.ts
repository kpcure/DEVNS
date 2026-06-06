import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DevnsConfig } from "./types";
import type { OrchestratorHost, OrchestratorMode } from "./orchestration";

type TracePacket = {
  mode: OrchestratorMode;
  host: OrchestratorHost;
  claimed?: boolean;
  stopHookRole?: string;
  reasons?: string[];
  featureId?: string;
  title?: string;
  implementationSubagent?: {
    name: string;
  };
  reviewSubagent?: {
    name: string;
  };
  mainAgentNextSteps?: string[];
};

export type OrchestratorTraceRecord = {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  name: "devns.orchestrate";
  kind: "agent.workflow";
  startedAt: string;
  completedAt: string;
  host: OrchestratorHost;
  mode: OrchestratorMode;
  featureId?: string;
  featureTitle?: string;
  claimed: boolean;
  stopHookRole?: string;
  reasons: string[];
  subagents: {
    implementation?: string;
    review?: string;
  };
  events: Array<{
    name: string;
    at: string;
    attributes?: Record<string, string | number | boolean>;
  }>;
  attributes: Record<string, string | number | boolean>;
  nextSteps: string[];
};

function traceDirFor(cwd: string, config: DevnsConfig) {
  const configured = config.traces ?? ".devns/traces";
  return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

export function orchestratorTracePath(cwd: string, config: DevnsConfig) {
  return path.join(traceDirFor(cwd, config), "orchestrator.jsonl");
}

function event(name: string, attributes?: Record<string, string | number | boolean>) {
  return {
    name,
    at: new Date().toISOString(),
    attributes
  };
}

export function buildOrchestratorTraceRecord(packet: TracePacket): OrchestratorTraceRecord {
  const startedAt = new Date().toISOString();
  const events: OrchestratorTraceRecord["events"] = [
    event("queue.inspect", {
      "devns.mode": packet.mode,
      "devns.host": packet.host
    })
  ];

  if (packet.featureId) {
    events.push(
      event("feature.selected", {
        "devns.feature.id": packet.featureId,
        "devns.claimed": Boolean(packet.claimed)
      })
    );
  }

  if (packet.claimed) {
    events.push(event("feature.claimed", { "devns.feature.id": packet.featureId ?? "" }));
  }

  if (packet.implementationSubagent || packet.reviewSubagent) {
    events.push(
      event("handoff.prepared", {
        "devns.subagent.implementation": packet.implementationSubagent?.name ?? "",
        "devns.subagent.review": packet.reviewSubagent?.name ?? ""
      })
    );
  }

  return {
    schemaVersion: 1,
    traceId: randomUUID(),
    spanId: randomUUID(),
    name: "devns.orchestrate",
    kind: "agent.workflow",
    startedAt,
    completedAt: new Date().toISOString(),
    host: packet.host,
    mode: packet.mode,
    featureId: packet.featureId,
    featureTitle: packet.title,
    claimed: Boolean(packet.claimed),
    stopHookRole: packet.stopHookRole,
    reasons: packet.reasons ?? [],
    subagents: {
      implementation: packet.implementationSubagent?.name,
      review: packet.reviewSubagent?.name
    },
    events,
    attributes: {
      "devns.host": packet.host,
      "devns.mode": packet.mode,
      "devns.claimed": Boolean(packet.claimed),
      "devns.feature.id": packet.featureId ?? "",
      "devns.stop_hook.role": packet.stopHookRole ?? ""
    },
    nextSteps: packet.mainAgentNextSteps ?? []
  };
}

export async function appendOrchestratorTrace(cwd: string, config: DevnsConfig, packet: TracePacket) {
  const filePath = orchestratorTracePath(cwd, config);
  await mkdir(path.dirname(filePath), { recursive: true });
  const record = buildOrchestratorTraceRecord(packet);
  await writeFile(filePath, `${JSON.stringify(record)}\n`, { flag: "a" });
  return {
    record,
    summary: {
      traceId: record.traceId,
      spanId: record.spanId,
      path: path.relative(cwd, filePath),
      eventCount: record.events.length
    }
  };
}

export async function readOrchestratorTraces(cwd: string, config: DevnsConfig, limit = 20) {
  try {
    const raw = await readFile(orchestratorTracePath(cwd, config), "utf8");
    const records = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OrchestratorTraceRecord);
    return limit > 0 ? records.slice(-limit) : records;
  } catch {
    return [];
  }
}

export type OrchestratorTraceAuditFinding = {
  severity: "warning" | "error";
  message: string;
  traceId?: string;
};

function hasEvent(record: OrchestratorTraceRecord, name: string) {
  return record.events.some((item) => item.name === name);
}

function traceText(record: OrchestratorTraceRecord) {
  return JSON.stringify(record).toLowerCase();
}

export function auditOrchestratorTraceRecord(record: OrchestratorTraceRecord): OrchestratorTraceAuditFinding[] {
  const findings: OrchestratorTraceAuditFinding[] = [];

  if (record.schemaVersion !== 1) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record schemaVersion must be 1." });
  }

  if (!record.traceId || !record.spanId) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record must include traceId and spanId." });
  }

  if (record.name !== "devns.orchestrate" || record.kind !== "agent.workflow") {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record must use devns.orchestrate agent.workflow identity." });
  }

  if (!hasEvent(record, "queue.inspect")) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record must include queue.inspect event." });
  }

  if (record.featureId && !hasEvent(record, "feature.selected")) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Feature trace must include feature.selected event." });
  }

  if (record.claimed && (record.mode !== "claim_next" || !hasEvent(record, "feature.claimed"))) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Claimed trace must be claim_next and include feature.claimed event." });
  }

  if (["claim_next", "continue_active", "blocked_ready"].includes(record.mode) && !hasEvent(record, "handoff.prepared")) {
    findings.push({ severity: "warning", traceId: record.traceId, message: "Feature orchestration trace should include handoff.prepared event." });
  }

  if (record.mode === "empty_queue" && record.featureId) {
    findings.push({ severity: "error", traceId: record.traceId, message: "empty_queue trace must not select a feature." });
  }

  const text = traceText(record);
  const forbidden = ["worker handoff json", "required output", "```diff", "transcript_path", "\"prompt\"", "\"stdout\"", "\"stderr\""];
  for (const marker of forbidden) {
    if (text.includes(marker)) {
      findings.push({ severity: "error", traceId: record.traceId, message: `Trace record contains forbidden prompt/diff/transcript marker: ${marker}.` });
    }
  }

  return findings;
}

export function auditOrchestratorTraces(records: OrchestratorTraceRecord[]) {
  const findings = records.flatMap(auditOrchestratorTraceRecord);
  return {
    decision: findings.some((finding) => finding.severity === "error") ? ("fail" as const) : ("pass" as const),
    records: records.length,
    findings
  };
}
