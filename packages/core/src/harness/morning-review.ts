import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildArtifactDigests, type ArtifactDigest } from "./artifact-digest";
import { evaluateEvidenceQuality, type EvidenceQualityReport } from "./evidence-quality";
import { historyPathForFeature, readExecutionHistoryRecords } from "./history";
import { readConfig, readInventory, resolveFromCwd } from "./state";
import type { DevnsConfig, Evidence, ExecutionHistoryRecord, Feature, FeatureInventory } from "./types";

const execFileAsync = promisify(execFile);

export type HumanAction = "approve" | "inspect_diff" | "needs_fix" | "follow_up";
export type ReviewCompletionStatus = "review_completed" | "review_packet_ready" | "missing";

export type ReviewDiffSummary = {
  base?: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  stat: string;
  patch: string;
  truncated: boolean;
};

export type FeatureReviewPacket = {
  featureId: string;
  title: string;
  status: Feature["status"];
  risk: Feature["risk"];
  suggestedAction: HumanAction;
  rfcIntent?: string;
  commit?: string;
  implementationCommit?: string;
  metadataCommit?: string;
  changedFiles: string[];
  implementationFiles: string[];
  stateFiles: string[];
  diff?: ReviewDiffSummary;
  evidenceQuality: EvidenceQualityReport;
  reviewStatus: ReviewCompletionStatus;
  evidence: string[];
  artifactRefs: string[];
  artifactDigests: ArtifactDigest[];
  acceptanceCoverage: Array<{
    criterion: string;
    evidence: string[];
  }>;
  decisions: string[];
  pitfalls: string[];
  errors: string[];
  fixes: string[];
  lessons: string[];
  risks: string[];
  historyPath?: string;
};

export type MorningReviewReport = {
  date: string;
  generatedAt: string;
  project: FeatureInventory["project"];
  summary: {
    featureCount: number;
    needsHumanReview: number;
    highRisk: number;
  };
  packets: FeatureReviewPacket[];
  crossFeatureRisks: string[];
  evalTrend?: EvalTrendPayload;
};

export type EvalT3GroupMetrics = {
  label: string;
  total: number;
  passed: number;
  failed: number;
  actualAllowed: number;
  actualBlocked: number;
  attempts: number;
  successfulAttempts: number;
  attemptSuccessRate: number;
  averagePassK: number;
  elapsedMs: number;
  estimatedCostUsd: number;
  failureTaxonomy: Record<string, number>;
};

export type EvalT3Metrics = Omit<EvalT3GroupMetrics, "label"> & {
  byProjectType: EvalT3GroupMetrics[];
  byRiskArea: EvalT3GroupMetrics[];
};

export type EvalTrendRecord = {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  t3: EvalT3Metrics;
};

export type EvalTrendPayload = {
  path: string;
  latest?: EvalTrendRecord;
  history: EvalTrendRecord[];
};

function reviewOutputDir(cwd: string, config: DevnsConfig) {
  const configured = config.review?.outputDir ?? ".devns/reviews";
  return resolveFromCwd(cwd, configured);
}

function evalHistoryPath(cwd: string) {
  return resolveFromCwd(cwd, process.env.DEVNS_EVAL_HISTORY_PATH ?? "evals/out/eval-history.jsonl");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function relativePath(cwd: string, filePath: string) {
  return path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
}

async function readEvalTrend(cwd: string): Promise<EvalTrendPayload> {
  const filePath = evalHistoryPath(cwd);
  try {
    const raw = await readFile(filePath, "utf8");
    const history = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvalTrendRecord)
      .slice(-10);
    return {
      path: relativePath(cwd, filePath),
      latest: history.at(-1),
      history
    };
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      return {
        path: relativePath(cwd, filePath),
        history: []
      };
    }
    throw error;
  }
}

function formatEvidence(item: Evidence) {
  const artifacts = item.artifactRefs?.length ? ` [artifacts: ${item.artifactRefs.join(", ")}]` : "";
  return `${item.type}: ${item.summary}${artifacts}`;
}

function evidenceSummaries(feature: Feature) {
  return (feature.evidence ?? []).map(formatEvidence);
}

function featureArtifactRefs(feature: Feature) {
  const featureRefs = Object.values(feature.artifactRefs ?? {}).filter((value): value is string => Boolean(value));
  const evidenceRefs = (feature.evidence ?? []).flatMap((item) => item.artifactRefs ?? []);
  return unique([...featureRefs, ...evidenceRefs]);
}

async function git(cwd: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function inferCommitForFeature(cwd: string, feature: Feature) {
  const configured = feature.implementationCommit ?? feature.commit;
  if (configured) return configured;

  const byFeatureId = await git(cwd, ["log", "--all", "-n", "1", "--format=%H", `--grep=^${feature.id}[: ]`]);
  if (byFeatureId) return byFeatureId;

  return undefined;
}

function trimDiff(value: string) {
  const maxLength = 28_000;
  if (value.length <= maxLength) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, maxLength)}\n... truncated by DEVNS morning review ...`,
    truncated: true
  };
}

function parseDiffStat(stat: string) {
  const summary = stat.split("\n").at(-1) ?? "";
  return {
    filesChanged: Number(summary.match(/(\d+) files? changed/)?.[1] ?? 0),
    insertions: Number(summary.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0),
    deletions: Number(summary.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0)
  };
}

async function diffForFeature(cwd: string, feature: Feature): Promise<ReviewDiffSummary | undefined> {
  const base = await inferCommitForFeature(cwd, feature);
  if (!base) return undefined;

  const stat = await git(cwd, ["show", "--stat", "--oneline", "--find-renames", base]);
  const patch = trimDiff(await git(cwd, ["show", "--format=", "--find-renames", base]));
  const parsed = parseDiffStat(stat);
  const filesChanged = parsed.filesChanged || feature.changedFiles?.length || 0;
  return {
    base,
    filesChanged,
    insertions: parsed.insertions,
    deletions: parsed.deletions,
    stat,
    patch: patch.value,
    truncated: patch.truncated
  };
}

function latestHistoryPath(cwd: string, config: DevnsConfig, feature: Feature) {
  const configured = feature.history?.historyPath;
  return configured ? resolveFromCwd(cwd, configured) : historyPathForFeature(cwd, config, feature.id);
}

async function historyForFeature(cwd: string, config: DevnsConfig, feature: Feature) {
  const filePath = latestHistoryPath(cwd, config, feature);
  const records = await readExecutionHistoryRecords(filePath);
  return { filePath, records };
}

function flattenHistory(records: ExecutionHistoryRecord[]) {
  return {
    decisions: unique(records.flatMap((record) => record.decisions ?? [])),
    pitfalls: unique(records.flatMap((record) => (record.pitfalls ?? []).map((item) => item.summary))),
    errors: unique(records.flatMap((record) => (record.errors ?? []).map((item) => item.summary))),
    fixes: unique(records.flatMap((record) => record.fixes ?? [])),
    lessons: unique(records.flatMap((record) => record.lessons ?? [])),
    risks: unique(records.flatMap((record) => record.risks ?? []))
  };
}

function hasReviewEvidence(feature: Feature) {
  return (feature.evidence ?? []).some((item) => /review|review-agent|code-review|human|manual|browser|e2e|visual/i.test(item.type));
}

function suggestedAction(feature: Feature, history: ReturnType<typeof flattenHistory>, evidenceQuality: EvidenceQualityReport): HumanAction {
  if (feature.reviewDecision === "needs_changes" || history.errors.length > 0) return "needs_fix";
  if (feature.reviewDecision === "follow_up" || history.risks.length > 0) return "follow_up";
  if (evidenceQuality.decision !== "allow") return "inspect_diff";
  if (!hasReviewEvidence(feature)) return "inspect_diff";
  if (feature.risk === "high" || !feature.commit) return "inspect_diff";
  return "approve";
}

export async function buildFeatureReviewPacket(
  cwd: string,
  config: DevnsConfig,
  feature: Feature
): Promise<FeatureReviewPacket> {
  const history = await historyForFeature(cwd, config, feature);
  const flattened = flattenHistory(history.records);
  const evidence = evidenceSummaries(feature);
  const artifactRefs = featureArtifactRefs(feature);
  const artifactDigests = await buildArtifactDigests(cwd, artifactRefs, config.artifactIntegrity?.browserSmoke);
  const diff = await diffForFeature(cwd, feature);
  const evidenceQuality = evaluateEvidenceQuality(feature);
  const reviewStatus: ReviewCompletionStatus = hasReviewEvidence(feature) ? "review_completed" : diff ? "review_packet_ready" : "missing";
  return {
    featureId: feature.id,
    title: feature.title,
    status: feature.status,
    risk: feature.risk,
    suggestedAction: suggestedAction(feature, flattened, evidenceQuality),
    rfcIntent: feature.rfc?.summary,
    commit: feature.commit,
    implementationCommit: feature.implementationCommit,
    metadataCommit: feature.metadataCommit,
    changedFiles: feature.changedFiles ?? [],
    implementationFiles: feature.implementationFiles ?? (feature.changedFiles ?? []).filter((file) => !file.startsWith(".devns/")),
    stateFiles: feature.stateFiles ?? (feature.changedFiles ?? []).filter((file) => file.startsWith(".devns/")),
    diff,
    evidenceQuality,
    reviewStatus,
    evidence,
    artifactRefs,
    artifactDigests,
    acceptanceCoverage: evidenceQuality.coverage.map((item) => ({
      criterion: item.criterion,
      evidence: item.evidence.map(formatEvidence)
    })),
    ...flattened,
    historyPath: path.relative(cwd, history.filePath)
  };
}

function crossFeatureRisks(packets: FeatureReviewPacket[]) {
  const byFile = new Map<string, string[]>();
  for (const packet of packets) {
    for (const file of packet.changedFiles) {
      byFile.set(file, [...(byFile.get(file) ?? []), packet.featureId]);
    }
  }
  return [...byFile.entries()]
    .filter(([, featureIds]) => featureIds.length > 1)
    .map(([file, featureIds]) => `${file} changed by ${featureIds.join(", ")}`);
}

export async function buildMorningReviewReport(
  cwd: string,
  config: DevnsConfig,
  inventory: FeatureInventory,
  date = new Date().toISOString().slice(0, 10)
): Promise<MorningReviewReport> {
  const features = inventory.features.filter((feature) => feature.status === "done");
  const packets = await Promise.all(features.map((feature) => buildFeatureReviewPacket(cwd, config, feature)));
  const sortedPackets = packets.sort((a, b) => {
    const actionRank: Record<HumanAction, number> = { needs_fix: 0, inspect_diff: 1, follow_up: 2, approve: 3 };
    const riskRank: Record<NonNullable<Feature["risk"]>, number> = { high: 0, medium: 1, low: 2 };
    return actionRank[a.suggestedAction] - actionRank[b.suggestedAction] || riskRank[a.risk ?? "low"] - riskRank[b.risk ?? "low"];
  });
  return {
    date,
    generatedAt: new Date().toISOString(),
    project: inventory.project,
    summary: {
      featureCount: sortedPackets.length,
      needsHumanReview: sortedPackets.filter((packet) => packet.suggestedAction !== "approve").length,
      highRisk: sortedPackets.filter((packet) => packet.risk === "high").length
    },
    packets: sortedPackets,
    crossFeatureRisks: crossFeatureRisks(sortedPackets),
    evalTrend: await readEvalTrend(cwd)
  };
}

function markdownList(items: string[], empty = "None") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function artifactDigestLines(packet: FeatureReviewPacket) {
  return packet.artifactDigests.flatMap((digest) => [
    `${digest.status}: ${digest.summary}`,
    ...(digest.browserSmoke?.sampleUrls.length ? [`sample URLs: ${digest.browserSmoke.sampleUrls.join(", ")}`] : []),
    ...(digest.browserSmoke?.policyFindings.length ? digest.browserSmoke.policyFindings.map((finding) => `policy: ${finding}`) : [])
  ]);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function failureSummary(failures: Record<string, number>) {
  const entries = Object.entries(failures).sort(([, left], [, right]) => right - left);
  return entries.length ? entries.map(([name, count]) => `${name}:${count}`).join(", ") : "none";
}

function evalTrendLines(trend?: EvalTrendPayload) {
  const latest = trend?.latest;
  if (!latest) return ["- No eval trend history found."];
  return [
    `- Source: ${trend.path}`,
    `- Eval pass: ${latest.passed}/${latest.total}`,
    `- T3 decisions: ${latest.t3.actualAllowed} allowed, ${latest.t3.actualBlocked} blocked`,
    `- T3 seed success: ${latest.t3.successfulAttempts}/${latest.t3.attempts} (${pct(latest.t3.attemptSuccessRate)})`,
    `- T3 average pass^k: ${latest.t3.averagePassK.toFixed(3)}`,
    `- T3 elapsed: ${latest.t3.elapsedMs} ms`,
    `- T3 cost: $${latest.t3.estimatedCostUsd.toFixed(4)}`,
    `- T3 failures: ${failureSummary(latest.t3.failureTaxonomy)}`
  ];
}

export function renderMorningReviewMarkdown(report: MorningReviewReport) {
  const packetSections = report.packets.map((packet) =>
    [
      `## ${packet.featureId}: ${packet.title}`,
      "",
      `- Action: ${packet.suggestedAction}`,
      `- Risk: ${packet.risk ?? "low"}`,
      `- Commit: ${packet.commit ?? "missing"}`,
      `- RFC: ${packet.rfcIntent ?? "missing"}`,
      "",
      "### Changed Files",
      markdownList(packet.changedFiles),
      "",
      "### Evidence",
      markdownList(packet.evidence),
      "",
      "### Artifacts",
      markdownList(packet.artifactRefs),
      "",
      "### Artifact Digests",
      markdownList(artifactDigestLines(packet)),
      "",
      "### Decisions And Lessons",
      markdownList([...packet.decisions, ...packet.lessons]),
      "",
      "### Pitfalls And Errors",
      markdownList([...packet.pitfalls, ...packet.errors, ...packet.fixes])
    ].join("\n")
  );

  return [
    `# Morning Review ${report.date}`,
    "",
    `${report.summary.featureCount} completed feature(s), ${report.summary.needsHumanReview} needing human attention, ${report.summary.highRisk} high risk.`,
    "",
    "## Cross-Feature Risks",
    markdownList(report.crossFeatureRisks),
    "",
    "## Eval Trend",
    evalTrendLines(report.evalTrend).join("\n"),
    "",
    ...packetSections
  ].join("\n");
}

export async function writeMorningReviewReport(cwd: string, date?: string) {
  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const report = await buildMorningReviewReport(cwd, config, inventory, date);
  const outputDir = reviewOutputDir(cwd, config);
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${report.date}.json`);
  const markdownPath = path.join(outputDir, `${report.date}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, `${renderMorningReviewMarkdown(report)}\n`);
  return {
    report,
    jsonPath: path.relative(cwd, jsonPath),
    markdownPath: path.relative(cwd, markdownPath)
  };
}

export async function readLatestMorningReview(cwd: string, config: DevnsConfig) {
  const outputDir = reviewOutputDir(cwd, config);
  try {
    const files = (await readdir(outputDir)).filter((file) => file.endsWith(".json")).sort();
    const latest = files.at(-1);
    if (!latest) return undefined;
    const raw = await readFile(path.join(outputDir, latest), "utf8");
    return JSON.parse(raw) as MorningReviewReport;
  } catch {
    return undefined;
  }
}
