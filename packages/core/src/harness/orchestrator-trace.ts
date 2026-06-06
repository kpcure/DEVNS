import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DevnsConfig } from "./types";
import type { OrchestratorHost, OrchestratorMode } from "./orchestration";

type TraceAttributes = Record<string, string | number | boolean>;
type TraceEvent = {
  name: string;
  at: string;
  attributes?: TraceAttributes;
};

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

type BaseTraceRecord = {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: "devns.orchestrate" | "devns.lanes.run" | "devns.lanes.ingest" | "devns.complete";
  kind: "agent.workflow" | "tool.command";
  startedAt: string;
  completedAt: string;
  featureId?: string;
  featureTitle?: string;
  events: TraceEvent[];
  attributes: TraceAttributes;
};

export type OrchestratorTraceRecord = BaseTraceRecord & {
  name: "devns.orchestrate";
  kind: "agent.workflow";
  host: OrchestratorHost;
  mode: OrchestratorMode;
  claimed: boolean;
  stopHookRole?: string;
  reasons: string[];
  subagents: {
    implementation?: string;
    review?: string;
  };
  nextSteps: string[];
};

export type WorkflowTraceRecord = BaseTraceRecord & {
  name: "devns.lanes.run" | "devns.lanes.ingest" | "devns.complete";
  kind: "tool.command";
  reasons?: string[];
};

export type DevnsTraceRecord = OrchestratorTraceRecord | WorkflowTraceRecord;

export type WorkflowTracePacket = {
  name: WorkflowTraceRecord["name"];
  featureId?: string;
  featureTitle?: string;
  parentSpanId?: string;
  events: Array<{
    name: string;
    attributes?: TraceAttributes;
  }>;
  attributes?: TraceAttributes;
  reasons?: string[];
};

export type TraceAppendSummary = {
  traceId: string;
  spanId: string;
  path: string;
  eventCount: number;
  error?: string;
};

function traceDirFor(cwd: string, config: DevnsConfig) {
  const configured = config.traces ?? ".devns/traces";
  return path.isAbsolute(configured) ? configured : path.join(cwd, configured);
}

export function orchestratorTracePath(cwd: string, config: DevnsConfig) {
  return path.join(traceDirFor(cwd, config), "orchestrator.jsonl");
}

function event(name: string, attributes?: TraceAttributes): TraceEvent {
  return {
    name,
    at: new Date().toISOString(),
    attributes
  };
}

function baseRecord<Name extends DevnsTraceRecord["name"], Kind extends DevnsTraceRecord["kind"]>(packet: {
  name: Name;
  kind: Kind;
  featureId?: string;
  featureTitle?: string;
  parentSpanId?: string;
  events: TraceEvent[];
  attributes: TraceAttributes;
}): BaseTraceRecord & { name: Name; kind: Kind } {
  const startedAt = new Date().toISOString();
  return {
    schemaVersion: 1 as const,
    traceId: randomUUID(),
    spanId: randomUUID(),
    parentSpanId: packet.parentSpanId,
    name: packet.name,
    kind: packet.kind,
    startedAt,
    completedAt: new Date().toISOString(),
    featureId: packet.featureId,
    featureTitle: packet.featureTitle,
    events: packet.events,
    attributes: packet.attributes
  };
}

export function buildOrchestratorTraceRecord(packet: TracePacket): OrchestratorTraceRecord {
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
    ...baseRecord({
      name: "devns.orchestrate",
      kind: "agent.workflow",
      featureId: packet.featureId,
      featureTitle: packet.title,
      events,
      attributes: {
        "devns.host": packet.host,
        "devns.mode": packet.mode,
        "devns.claimed": Boolean(packet.claimed),
        "devns.feature.id": packet.featureId ?? "",
        "devns.stop_hook.role": packet.stopHookRole ?? ""
      }
    }),
    host: packet.host,
    mode: packet.mode,
    claimed: Boolean(packet.claimed),
    stopHookRole: packet.stopHookRole,
    reasons: packet.reasons ?? [],
    subagents: {
      implementation: packet.implementationSubagent?.name,
      review: packet.reviewSubagent?.name
    },
    nextSteps: packet.mainAgentNextSteps ?? []
  };
}

export function buildWorkflowTraceRecord(packet: WorkflowTracePacket): WorkflowTraceRecord {
  return {
    ...baseRecord({
      name: packet.name,
      kind: "tool.command",
      featureId: packet.featureId,
      featureTitle: packet.featureTitle,
      parentSpanId: packet.parentSpanId,
      events: packet.events.map((item) => event(item.name, item.attributes)),
      attributes: {
        "devns.feature.id": packet.featureId ?? "",
        ...(packet.attributes ?? {})
      }
    }),
    reasons: packet.reasons ?? []
  };
}

async function appendTraceRecord(cwd: string, config: DevnsConfig, record: DevnsTraceRecord) {
  const filePath = orchestratorTracePath(cwd, config);
  await mkdir(path.dirname(filePath), { recursive: true });
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

export async function appendOrchestratorTrace(cwd: string, config: DevnsConfig, packet: TracePacket) {
  return appendTraceRecord(cwd, config, buildOrchestratorTraceRecord(packet));
}

export async function appendWorkflowTrace(cwd: string, config: DevnsConfig, packet: WorkflowTracePacket) {
  return appendTraceRecord(cwd, config, buildWorkflowTraceRecord(packet));
}

export async function appendWorkflowTraceSafely(cwd: string, config: DevnsConfig, packet: WorkflowTracePacket): Promise<TraceAppendSummary> {
  try {
    const trace = await appendWorkflowTrace(cwd, config, packet);
    return trace.summary;
  } catch (error) {
    return {
      traceId: "",
      spanId: "",
      path: "",
      eventCount: 0,
      error: error instanceof Error ? error.message : "Unable to write workflow trace."
    };
  }
}

export async function readOrchestratorTraces(cwd: string, config: DevnsConfig, limit = 20): Promise<DevnsTraceRecord[]> {
  try {
    const raw = await readFile(orchestratorTracePath(cwd, config), "utf8");
    const records = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DevnsTraceRecord);
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

function hasEvent(record: DevnsTraceRecord, name: string) {
  return record.events.some((item) => item.name === name);
}

function traceText(record: DevnsTraceRecord) {
  return JSON.stringify(record).toLowerCase();
}

function auditOrchestratorRecord(record: OrchestratorTraceRecord) {
  const findings: OrchestratorTraceAuditFinding[] = [];

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

  return findings;
}

function auditWorkflowRecord(record: WorkflowTraceRecord) {
  const findings: OrchestratorTraceAuditFinding[] = [];

  if (!record.featureId) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Workflow trace record must include featureId." });
  }

  if (!record.events.length) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Workflow trace record must include at least one event." });
  }

  if (record.name === "devns.lanes.run" && !hasEvent(record, "lane.run")) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Lane-run trace must include lane.run event." });
  }

  if (record.name === "devns.lanes.ingest" && !hasEvent(record, "lane.result.ingested")) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Lane-ingest trace must include lane.result.ingested event." });
  }

  if (record.name === "devns.complete" && !hasEvent(record, "feature.completed")) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Completion trace must include feature.completed event." });
  }

  return findings;
}

export function auditOrchestratorTraceRecord(record: DevnsTraceRecord): OrchestratorTraceAuditFinding[] {
  const findings: OrchestratorTraceAuditFinding[] = [];

  if (record.schemaVersion !== 1) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record schemaVersion must be 1." });
  }

  if (!record.traceId || !record.spanId) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record must include traceId and spanId." });
  }

  if (!record.name?.startsWith("devns.") || !["agent.workflow", "tool.command"].includes(record.kind)) {
    findings.push({ severity: "error", traceId: record.traceId, message: "Trace record must use a DEVNS workflow/tool identity." });
  }

  findings.push(...(record.name === "devns.orchestrate" ? auditOrchestratorRecord(record) : auditWorkflowRecord(record)));

  const text = traceText(record);
  const forbidden = ["worker handoff json", "required output", "```diff", "transcript_path", "\"prompt\"", "\"stdout\"", "\"stderr\""];
  for (const marker of forbidden) {
    if (text.includes(marker)) {
      findings.push({ severity: "error", traceId: record.traceId, message: `Trace record contains forbidden prompt/diff/transcript marker: ${marker}.` });
    }
  }

  return findings;
}

function eventTime(record: DevnsTraceRecord, name: string) {
  const eventItem = record.events.find((item) => item.name === name);
  const timestamp = eventItem ? Date.parse(eventItem.at) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function auditTraceContinuity(records: DevnsTraceRecord[]) {
  const findings: OrchestratorTraceAuditFinding[] = [];
  const byFeature = new Map<string, DevnsTraceRecord[]>();

  for (const record of records) {
    if (!record.featureId) continue;
    byFeature.set(record.featureId, [...(byFeature.get(record.featureId) ?? []), record]);
  }

  for (const [featureId, featureRecords] of byFeature.entries()) {
    const completedRecords = featureRecords.filter((record) => hasEvent(record, "feature.completed"));
    if (!completedRecords.length) continue;

    const hasHandoff = featureRecords.some((record) => hasEvent(record, "handoff.prepared"));
    const hasLaneEvidence = featureRecords.some((record) => hasEvent(record, "lane.run") || hasEvent(record, "lane.result.ingested"));
    const hasReviewDecision = featureRecords.some((record) => hasEvent(record, "review.decision") || hasEvent(record, "review.result"));

    if (!hasHandoff) {
      findings.push({ severity: "error", traceId: completedRecords[0]?.traceId, message: `Completed feature ${featureId} trace must include handoff.prepared before completion.` });
    }

    if (!hasLaneEvidence) {
      findings.push({ severity: "error", traceId: completedRecords[0]?.traceId, message: `Completed feature ${featureId} trace must include lane.run or lane.result.ingested before completion.` });
    }

    if (!hasReviewDecision) {
      findings.push({ severity: "error", traceId: completedRecords[0]?.traceId, message: `Completed feature ${featureId} trace must include review.decision or review.result before completion.` });
    }

    const firstComplete = Math.min(...completedRecords.map((record) => eventTime(record, "feature.completed") ?? Number.POSITIVE_INFINITY));
    const firstLane = Math.min(
      ...featureRecords.map((record) => eventTime(record, "lane.run") ?? eventTime(record, "lane.result.ingested") ?? Number.POSITIVE_INFINITY)
    );
    const firstReview = Math.min(
      ...featureRecords.map((record) => eventTime(record, "review.decision") ?? eventTime(record, "review.result") ?? Number.POSITIVE_INFINITY)
    );

    if (Number.isFinite(firstComplete) && Number.isFinite(firstLane) && firstLane > firstComplete) {
      findings.push({ severity: "error", traceId: completedRecords[0]?.traceId, message: `Completed feature ${featureId} trace records lane evidence after completion.` });
    }

    if (Number.isFinite(firstComplete) && Number.isFinite(firstReview) && firstReview > firstComplete) {
      findings.push({ severity: "error", traceId: completedRecords[0]?.traceId, message: `Completed feature ${featureId} trace records review decision after completion.` });
    }
  }

  return findings;
}

export function auditOrchestratorTraces(records: DevnsTraceRecord[]) {
  const findings = [...records.flatMap(auditOrchestratorTraceRecord), ...auditTraceContinuity(records)];
  return {
    decision: findings.some((finding) => finding.severity === "error") ? ("fail" as const) : ("pass" as const),
    records: records.length,
    findings
  };
}
