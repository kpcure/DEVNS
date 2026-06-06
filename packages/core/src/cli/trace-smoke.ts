#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { auditOrchestratorTraceRecord, auditOrchestratorTraces, type DevnsTraceRecord, type OrchestratorTraceRecord } from "../harness/orchestrator-trace";

const execFileAsync = promisify(execFile);

async function runDevns(repoRoot: string, cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [
    "--import",
    path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
    path.join(repoRoot, "packages/core/src/cli/devns.ts"),
    ...args
  ], { cwd });
  return stdout;
}

function record(overrides: Partial<OrchestratorTraceRecord> = {}): OrchestratorTraceRecord {
  return {
    schemaVersion: 1,
    traceId: "trace-1",
    spanId: "span-1",
    name: "devns.orchestrate",
    kind: "agent.workflow",
    startedAt: "2026-06-06T00:00:00.000Z",
    completedAt: "2026-06-06T00:00:01.000Z",
    host: "codex",
    mode: "claim_next",
    featureId: "TRACE-001",
    featureTitle: "Trace smoke",
    claimed: true,
    stopHookRole: "safety_net_only",
    reasons: [],
    subagents: {
      implementation: "devns_feature_worker",
      review: "devns_code_reviewer"
    },
    events: [
      { name: "queue.inspect", at: "2026-06-06T00:00:00.000Z" },
      { name: "feature.selected", at: "2026-06-06T00:00:00.100Z" },
      { name: "feature.claimed", at: "2026-06-06T00:00:00.200Z" },
      { name: "handoff.prepared", at: "2026-06-06T00:00:00.300Z" }
    ],
    attributes: {
      "devns.host": "codex",
      "devns.mode": "claim_next",
      "devns.claimed": true,
      "devns.feature.id": "TRACE-001",
      "devns.stop_hook.role": "safety_net_only"
    },
    nextSteps: ["Launch implementation subagent."],
    ...overrides
  };
}

function workflowRecord(overrides: Partial<DevnsTraceRecord>): DevnsTraceRecord {
  return {
    schemaVersion: 1,
    traceId: "trace-workflow",
    spanId: `span-${overrides.name ?? "workflow"}`,
    name: "devns.lanes.run",
    kind: "tool.command",
    startedAt: "2026-06-06T00:00:02.000Z",
    completedAt: "2026-06-06T00:00:03.000Z",
    featureId: "TRACE-001",
    events: [{ name: "lane.run", at: "2026-06-06T00:00:02.500Z" }],
    attributes: { "devns.feature.id": "TRACE-001" },
    ...overrides
  } as DevnsTraceRecord;
}

async function main() {
  const good = record();
  const leaked = record({
    traceId: "trace-2",
    nextSteps: ["Worker handoff JSON must not be logged."]
  });
  const lane = workflowRecord({
    traceId: "trace-3",
    spanId: "span-lanes",
    name: "devns.lanes.run",
    events: [{ name: "lane.run", at: "2026-06-06T00:00:02.500Z" }]
  });
  const review = workflowRecord({
    traceId: "trace-4",
    spanId: "span-review",
    name: "devns.lanes.ingest",
    events: [
      { name: "lane.result.ingested", at: "2026-06-06T00:00:03.000Z" },
      { name: "review.result", at: "2026-06-06T00:00:03.100Z" }
    ]
  });
  const complete = workflowRecord({
    traceId: "trace-5",
    spanId: "span-complete",
    name: "devns.complete",
    events: [
      { name: "review.decision", at: "2026-06-06T00:00:04.000Z" },
      { name: "feature.completed", at: "2026-06-06T00:00:04.100Z" }
    ]
  });
  const lonelyComplete = workflowRecord({
    traceId: "trace-6",
    spanId: "span-lonely-complete",
    name: "devns.complete",
    events: [
      { name: "review.decision", at: "2026-06-06T00:00:04.000Z" },
      { name: "feature.completed", at: "2026-06-06T00:00:04.100Z" }
    ]
  });
  assert.equal(auditOrchestratorTraceRecord(good).length, 0);
  assert.equal(auditOrchestratorTraceRecord(leaked).some((finding) => finding.message.includes("forbidden")), true);
  assert.equal(auditOrchestratorTraces([good, lane, review, complete]).decision, "pass");
  assert.equal(auditOrchestratorTraces([lonelyComplete]).decision, "fail");

  const repoRoot = process.cwd();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-trace-"));
  await mkdir(path.join(cwd, ".devns", "traces"), { recursive: true });
  await writeFile(
    path.join(cwd, ".devns", "devns.config.json"),
    JSON.stringify({ version: 1, features: ".devns/features.json", traces: ".devns/traces" }, null, 2)
  );
  await writeFile(path.join(cwd, ".devns", "features.json"), JSON.stringify({ project: { name: "Trace", description: "Trace" }, features: [] }, null, 2));
  await writeFile(
    path.join(cwd, ".devns", "traces", "orchestrator.jsonl"),
    [good, lane, review, complete].map((item) => JSON.stringify(item)).join("\n") + "\n"
  );

  const output = JSON.parse(await runDevns(repoRoot, cwd, "trace", "--json", "--audit")) as {
    records: DevnsTraceRecord[];
    audit: { decision: "pass" | "fail" };
  };
  assert.equal(output.records.length, 4);
  assert.equal(output.audit.decision, "pass");

  process.stdout.write("Trace smoke passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown trace smoke error"}\n`);
  process.exitCode = 1;
});
