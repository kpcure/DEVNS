import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Code2,
  FileDiff,
  GitBranch,
  FileJson2,
  Filter,
  GitCommitHorizontal,
  LayoutDashboard,
  ListChecks,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  X
} from "lucide-react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable
} from "@tanstack/react-table";
import "./styles.css";

type Status = "ready" | "in_progress" | "done" | "blocked" | "failed";
type Priority = "P0" | "P1" | "P2" | "P3";
type Risk = "low" | "medium" | "high";

type Evidence = {
  type: string;
  summary: string;
  url?: string;
};

type RfcStatus = "draft" | "needs_human_review" | "approved" | "needs_changes" | "blocked" | "superseded";
type TestTarget = "unit" | "integration" | "e2e" | "static" | "manual";

type FeatureRfc = {
  status: RfcStatus;
  summary: string;
  background: string;
  featureDescription: string;
  expectedOutcome: string;
  goals: string[];
  nonGoals: string[];
  requirements: Array<{
    id: string;
    type: "explicit" | "implicit";
    statement: string;
    source?: string;
    priority: "must" | "should" | "could";
  }>;
  acceptanceCriteria: Array<{
    id: string;
    requirementIds?: string[];
    statement: string;
    verification?: string;
  }>;
  validationPlan: {
    dynamic: string[];
    static: string[];
  };
  testCases: Array<{
    id: string;
    acceptanceCriteriaIds?: string[];
    type: TestTarget;
    scenario: string;
    expected: string;
    candidateTestName?: string;
  }>;
  unknowns?: Array<{
    question: string;
    severity: "blocking" | "non_blocking";
    owner?: "human" | "agent";
  }>;
  risks?: string[];
  humanDecision?: {
    status: "pending" | "approved" | "needs_changes" | "rejected";
    decidedBy?: string;
    decidedAt?: string;
    notes?: string;
  };
};

type Feature = {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  milestone: string;
  risk: Risk;
  context: string[];
  acceptanceCriteria: string[];
  verification: string[];
  evidence: Evidence[];
  changedFiles: string[];
  commit: string;
  implementationCommit?: string;
  metadataCommit?: string;
  review: {
    confidence: "low" | "medium" | "high";
    summary: string;
    risks: string[];
  };
  reviewDecision: "pending" | "approved" | "needs_changes" | "follow_up";
  agentNotes: string;
  rfc?: FeatureRfc;
};

function isExtensionRelatedFeature(feature: Feature) {
  const text = [feature.title, feature.description, feature.milestone, ...(feature.context ?? [])].join(" ").toLowerCase();
  return /\b(extension|plugin|hook|lane|skill|agent|policy|dashboard|review)\b/.test(text);
}

type OpenQuestion = {
  id: string;
  title: string;
  area: string;
  severity: "low" | "medium" | "high";
  options: string[];
  recommended: string;
};

type Source = {
  title: string;
  url: string;
  takeaway: string;
};

type Candidate = {
  id: string;
  title: string;
  description: string;
  status?: "discovered" | "needs_rfc" | "rejected" | "promoted";
  sources?: string[];
  confidence?: "low" | "medium" | "high";
  suggestedPriority?: Priority;
  suggestedRisk?: Risk;
  suggestedMilestone?: string;
};

type ExtensionPoint = {
  name: string;
  kind: "core" | "edge";
  description: string;
};

type ReviewPacket = {
  featureId: string;
  title: string;
  status?: Status;
  risk?: Risk;
  suggestedAction: "approve" | "inspect_diff" | "needs_fix" | "follow_up";
  rfcIntent?: string;
  commit?: string;
  implementationCommit?: string;
  metadataCommit?: string;
  changedFiles: string[];
  implementationFiles?: string[];
  stateFiles?: string[];
  diff?: {
    base?: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    stat: string;
    patch: string;
    truncated: boolean;
  };
  evidenceQuality?: {
    decision: "allow" | "warn" | "block" | "needs_human_review";
    summary: string;
  };
  reviewStatus?: "review_completed" | "review_packet_ready" | "missing";
  evidence: string[];
  acceptanceCoverage?: Array<{
    criterion: string;
    evidence: string[];
  }>;
  decisions?: string[];
  pitfalls: string[];
  errors: string[];
  fixes?: string[];
  lessons: string[];
  risks?: string[];
  historyPath?: string;
};

type MorningReviewReport = {
  date: string;
  summary: {
    featureCount: number;
    needsHumanReview: number;
    highRisk: number;
  };
  packets: ReviewPacket[];
  crossFeatureRisks: string[];
};

type Roadmap = {
  revision?: string;
  project: {
    name: string;
    description: string;
    repository: string;
  };
  features: Feature[];
  candidates?: Candidate[];
  openQuestions: OpenQuestion[];
  researchSources: Source[];
};

const fallbackData: Roadmap = {
  project: {
    name: "DEVNS Harness",
    description: "Loading project state from JSON...",
    repository: ""
  },
  features: [],
  openQuestions: [],
  researchSources: []
};

const statusLabel: Record<Status, string> = {
  ready: "Ready",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
  failed: "Failed"
};

const decisionLabel: Record<Feature["reviewDecision"], string> = {
  pending: "Pending",
  approved: "Approved",
  needs_changes: "Needs changes",
  follow_up: "Follow up"
};

const rfcStatusLabel: Record<RfcStatus, string> = {
  draft: "RFC draft",
  needs_human_review: "RFC review",
  approved: "RFC approved",
  needs_changes: "RFC changes",
  blocked: "RFC blocked",
  superseded: "RFC superseded"
};

const statusOptions: Status[] = ["ready", "in_progress", "done", "blocked", "failed"];
const priorityOptions: Priority[] = ["P0", "P1", "P2", "P3"];
const decisionOptions: Feature["reviewDecision"][] = ["pending", "approved", "needs_changes", "follow_up"];
const rfcHumanDecisionOptions: NonNullable<FeatureRfc["humanDecision"]>["status"][] = [
  "pending",
  "approved",
  "needs_changes",
  "rejected"
];

type FeaturePatch = Partial<Pick<Feature, "status" | "priority" | "reviewDecision" | "agentNotes" | "rfc">>;

async function loadRoadmap() {
  const response = await fetch("/api/roadmap");
  if (!response.ok) {
    throw new Error(`Failed to load roadmap: ${response.status}`);
  }
  return (await response.json()) as Roadmap;
}

async function loadLatestReview() {
  const response = await fetch("/api/reviews/latest");
  if (!response.ok) {
    throw new Error(`Failed to load latest review: ${response.status}`);
  }
  return ((await response.json()) as { report?: MorningReviewReport }).report;
}

async function patchFeature(featureId: string, patch: FeaturePatch, expectedRevision?: string) {
  const response = await fetch(`/api/features/${encodeURIComponent(featureId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ patch, expectedRevision })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to save ${featureId}`);
  }

  return (await response.json()) as { feature: Feature; revision?: string };
}

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Pill({
  children,
  tone = "neutral"
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  return <span className={cx("pill", `pill-${tone}`)}>{children}</span>;
}

function toneForRisk(risk: Risk) {
  if (risk === "high") return "bad";
  if (risk === "medium") return "warn";
  return "good";
}

function toneForStatus(status: Status) {
  if (status === "done") return "good";
  if (status === "in_progress") return "info";
  if (status === "blocked" || status === "failed") return "bad";
  return "neutral";
}

function toneForRfcStatus(status?: RfcStatus) {
  if (!status) return "neutral";
  if (status === "approved") return "good";
  if (status === "blocked" || status === "needs_changes") return "bad";
  if (status === "needs_human_review") return "warn";
  return "info";
}

function StatCard({
  icon,
  label,
  value,
  detail
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        <div className="stat-detail">{detail}</div>
      </div>
    </div>
  );
}

function MissionSummary({ features }: { features: Feature[] }) {
  const completed = features.filter((feature) => feature.status === "done").length;
  const inProgress = features.filter((feature) => feature.status === "in_progress").length;
  const highRisk = features.filter((feature) => feature.risk === "high").length;
  const pendingReview = features.filter((feature) => feature.reviewDecision === "pending").length;

  return (
    <section className="summary-grid" aria-label="Mission summary">
      <StatCard
        icon={<CheckCircle2 size={18} />}
        label="Completed"
        value={`${completed}/${features.length}`}
        detail="Feature-level progress"
      />
      <StatCard
        icon={<CircleDot size={18} />}
        label="Active"
        value={inProgress}
        detail="Currently claimed work"
      />
      <StatCard
        icon={<AlertTriangle size={18} />}
        label="High risk"
        value={highRisk}
        detail="Needs careful review"
      />
      <StatCard
        icon={<ClipboardCheck size={18} />}
        label="Review queue"
        value={pendingReview}
        detail="Human decisions pending"
      />
    </section>
  );
}

function NextAction({ features }: { features: Feature[] }) {
  const active = features.find((feature) => feature.status === "in_progress");
  const nextReady = features.find((feature) => feature.status === "ready" && feature.rfc?.status === "approved");
  const blockedReady = features.find((feature) => feature.status === "ready" && feature.rfc?.status !== "approved");

  let tone: "good" | "warn" | "info" | "neutral" = "neutral";
  let title = "No Claimable Work";
  let detail = "The queue is empty. Add candidates, clarify RFCs, or stop safely.";
  let command = "npm run devns:doctor";

  if (active) {
    tone = "info";
    title = `Continue ${active.id}`;
    detail = "An active feature is already claimed. Finish verification, update evidence/history, and commit exactly this feature before switching tasks.";
    command = "npm run devns:run -- --json";
  } else if (nextReady) {
    tone = "good";
    title = `Claim ${nextReady.id}`;
    detail = "A feature with an approved RFC is ready. Claim one feature, read its RFC, and keep the implementation scoped to that feature.";
    command = "npm run devns:run -- --json";
  } else if (blockedReady) {
    tone = "warn";
    title = `Clarify ${blockedReady.id}`;
    detail = "A ready item is blocked by RFC readiness. Use the RFC skill or ask the human to approve/update the RFC before implementation.";
    command = `npm run devns:rfc -- check --id ${blockedReady.id}`;
  }

  return (
    <section className="panel next-action">
      <div className="section-heading">
        <div>
          <h2>Next Action</h2>
          <p>{detail}</p>
        </div>
        <Pill tone={tone}>{title}</Pill>
      </div>
      <div className="command-strip">
        <Code2 size={15} aria-hidden="true" />
        <code>{command}</code>
      </div>
    </section>
  );
}

function DecisionRail({ sources = [] }: { sources?: Source[] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Research Decisions</h2>
          <p>Current choices that shape the first open-source implementation.</p>
        </div>
        <Pill tone="info">researched</Pill>
      </div>
      <div className="decision-list">
        {sources.length === 0 ? (
          <p className="empty-copy">No research decisions recorded yet.</p>
        ) : (
          sources.map((source) => (
            <a className="decision-item" href={source.url} key={source.title} target="_blank" rel="noreferrer">
              <div>
                <strong>{source.title}</strong>
                <p>{source.takeaway}</p>
              </div>
              <ChevronDown className="external-icon" size={16} aria-hidden="true" />
            </a>
          ))
        )}
      </div>
    </section>
  );
}

function CandidatePanel({ candidates = [] }: { candidates?: Candidate[] }) {
  const visibleCandidates = candidates.filter((candidate) => candidate.status !== "promoted").slice(0, 8);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Candidate Intake</h2>
          <p>Discovered work stays here until an RFC promotes it into the executable queue.</p>
        </div>
        <Pill tone={visibleCandidates.length ? "warn" : "good"}>{visibleCandidates.length} open</Pill>
      </div>
      {visibleCandidates.length === 0 ? (
        <p className="empty-copy">No unpromoted candidates. Run discovery when project context changes.</p>
      ) : (
        <div className="candidate-list">
          {visibleCandidates.map((candidate) => (
            <article className="candidate-item" key={candidate.id}>
              <div className="candidate-head">
                <div>
                  <span className="mono">{candidate.id}</span>
                  <strong>{candidate.title}</strong>
                </div>
                <Pill tone={candidate.confidence === "high" ? "good" : "warn"}>{candidate.confidence ?? "unknown"}</Pill>
              </div>
              <p>{candidate.description}</p>
              <div className="candidate-meta">
                <span>{candidate.status ?? "discovered"}</span>
                <span>{candidate.suggestedPriority ?? "P?"}</span>
                <span>{candidate.suggestedRisk ?? "risk?"}</span>
              </div>
              {candidate.sources && candidate.sources.length > 0 && (
                <div className="source-list" aria-label={`Sources for ${candidate.id}`}>
                  {candidate.sources.slice(0, 3).map((source) => (
                    <code key={source}>{source}</code>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FeatureTable({
  features,
  onPatchFeature
}: {
  features: Feature[];
  onPatchFeature: (featureId: string, patch: FeaturePatch) => Promise<void>;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePatch(featureId: string, patch: FeaturePatch) {
    setSavingId(featureId);
    setError(null);
    try {
      await onPatchFeature(featureId, patch);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save feature");
    } finally {
      setSavingId(null);
    }
  }

  const columns = useMemo<ColumnDef<Feature>[]>(
    () => [
      {
        accessorKey: "id",
        header: "ID",
        cell: ({ row }) => <span className="mono">{row.original.id}</span>
      },
      {
        accessorKey: "title",
        header: "Feature",
        cell: ({ row }) => (
          <div className="feature-cell">
            <strong>{row.original.title}</strong>
            <span>{row.original.description}</span>
          </div>
        )
      },
      {
        accessorKey: "milestone",
        header: "Milestone"
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => (
          <select
            className="inline-select"
            aria-label={`Priority for ${row.original.id}`}
            disabled={savingId === row.original.id}
            value={row.original.priority}
            onChange={(event) => savePatch(row.original.id, { priority: event.target.value as Priority })}
          >
            {priorityOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <select
            className="inline-select"
            aria-label={`Status for ${row.original.id}`}
            disabled={savingId === row.original.id}
            value={row.original.status}
            onChange={(event) => savePatch(row.original.id, { status: event.target.value as Status })}
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {statusLabel[option]}
              </option>
            ))}
          </select>
        )
      },
      {
        accessorKey: "risk",
        header: "Risk",
        cell: ({ row }) => <Pill tone={toneForRisk(row.original.risk)}>{row.original.risk}</Pill>
      },
      {
        accessorKey: "reviewDecision",
        header: "Review",
        cell: ({ row }) => (
          <select
            className="inline-select"
            aria-label={`Review decision for ${row.original.id}`}
            disabled={savingId === row.original.id}
            value={row.original.reviewDecision}
            onChange={(event) =>
              savePatch(row.original.id, { reviewDecision: event.target.value as Feature["reviewDecision"] })
            }
          >
            {decisionOptions.map((option) => (
              <option key={option} value={option}>
                {decisionLabel[option]}
              </option>
            ))}
          </select>
        )
      },
      {
        accessorKey: "agentNotes",
        header: "Notes",
        cell: ({ row }) => (
          <textarea
            className="notes-input"
            aria-label={`Agent notes for ${row.original.id}`}
            defaultValue={row.original.agentNotes}
            disabled={savingId === row.original.id}
            onBlur={(event) => {
              if (event.target.value !== row.original.agentNotes) {
                void savePatch(row.original.id, { agentNotes: event.target.value });
              }
            }}
          />
        )
      }
    ],
    [savingId]
  );

  const table = useReactTable({
    data: features,
    columns,
    state: {
      sorting,
      globalFilter
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  });

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Feature Backlog</h2>
          <p>Feature inventory loaded through the DEVNS local runtime.</p>
        </div>
        <div className="searchbox">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search features"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Search features"
          />
        </div>
      </div>
      <div className="sync-note">
        <span>{savingId ? `Saving ${savingId} to JSON...` : "Edits save back to the configured feature inventory."}</span>
        {error && <strong>{error}</strong>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    <button
                      className="th-button"
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <Filter size={13} />
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeatureReview({
  features,
  onPatchFeature
}: {
  features: Feature[];
  onPatchFeature: (featureId: string, patch: FeaturePatch) => Promise<void>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveRfc(feature: Feature, rfc: FeatureRfc) {
    setSavingId(feature.id);
    setError(null);
    try {
      await onPatchFeature(feature.id, { rfc });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save RFC decision");
    } finally {
      setSavingId(null);
    }
  }

  function patchHumanDecision(feature: Feature, patch: Partial<NonNullable<FeatureRfc["humanDecision"]>>) {
    if (!feature.rfc) return;
    const nextDecision = {
      status: "pending",
      ...feature.rfc.humanDecision,
      ...patch,
      decidedBy: patch.status ? "human-dashboard" : feature.rfc.humanDecision?.decidedBy,
      decidedAt: patch.status ? new Date().toISOString() : feature.rfc.humanDecision?.decidedAt
    } satisfies NonNullable<FeatureRfc["humanDecision"]>;
    void saveRfc(feature, {
      ...feature.rfc,
      humanDecision: nextDecision
    });
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Feature Review Cards</h2>
          <p>Each task shows intent, evidence, risks, and verification commands.</p>
        </div>
        <Pill tone="neutral">one feature per commit</Pill>
      </div>
      {error && <div className="sync-note sync-note-error">{error}</div>}
      <div className="cards-grid">
        {features.map((feature) => (
          <article className="feature-card" key={feature.id}>
            <div className="card-head">
              <div>
                <span className="mono">{feature.id}</span>
                <h3>{feature.title}</h3>
              </div>
              <div className="pill-row">
                <Pill tone={toneForStatus(feature.status)}>{statusLabel[feature.status]}</Pill>
                <Pill tone={toneForRisk(feature.risk)}>{feature.risk}</Pill>
                <Pill tone={toneForRfcStatus(feature.rfc?.status)}>
                  {feature.rfc ? rfcStatusLabel[feature.rfc.status] : "No RFC"}
                </Pill>
              </div>
            </div>
            <p className="card-copy">{feature.review?.summary || feature.description}</p>
            {feature.rfc && (
              <div className="rfc-summary">
                <strong>RFC</strong>
                <p>{feature.rfc.summary}</p>
                <div className="trace-grid" aria-label={`RFC traceability for ${feature.id}`}>
                  <span>{feature.rfc.requirements.length} reqs</span>
                  <span>{feature.rfc.acceptanceCriteria.length} ACs</span>
                  <span>{feature.rfc.testCases.length} cases</span>
                </div>
                <div className="rfc-controls">
                  <label>
                    <span>Human decision</span>
                    <select
                      className="inline-select"
                      aria-label={`RFC human decision for ${feature.id}`}
                      disabled={savingId === feature.id}
                      value={feature.rfc.humanDecision?.status ?? "pending"}
                      onChange={(event) =>
                        patchHumanDecision(feature, {
                          status: event.target.value as NonNullable<FeatureRfc["humanDecision"]>["status"]
                        })
                      }
                    >
                      {rfcHumanDecisionOptions.map((option) => (
                        <option key={option} value={option}>
                          {option.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Decision notes</span>
                    <textarea
                      className="rfc-note"
                      aria-label={`RFC decision notes for ${feature.id}`}
                      defaultValue={feature.rfc.humanDecision?.notes ?? ""}
                      disabled={savingId === feature.id}
                      onBlur={(event) => {
                        if (event.target.value !== (feature.rfc?.humanDecision?.notes ?? "")) {
                          patchHumanDecision(feature, { notes: event.target.value });
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="mini-section">
              <strong>Acceptance</strong>
              <ul>
                {feature.acceptanceCriteria.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="evidence-row">
              <div>
                <TestTube2 size={15} />
                {feature.verification.length} checks
              </div>
              <div>
                <GitCommitHorizontal size={15} />
                {feature.implementationCommit || feature.commit || "No commit yet"}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MorningReview({ report }: { report?: MorningReviewReport }) {
  const packets = report?.packets ?? [];
  const [selectedPacket, setSelectedPacket] = useState<ReviewPacket | undefined>();
  const actionTone: Record<ReviewPacket["suggestedAction"], "good" | "warn" | "bad" | "info"> = {
    approve: "good",
    inspect_diff: "warn",
    needs_fix: "bad",
    follow_up: "info"
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Morning Review</h2>
          <p>Feature packets ordered by human attention need.</p>
        </div>
        <Pill tone={report ? "info" : "neutral"}>{report?.date ?? "no report"}</Pill>
      </div>
      {!report ? (
        <div className="sync-note">Generate one with `npm run devns:review -- generate`.</div>
      ) : (
        <div className="review-packet-list">
          <div className="review-summary-row">
            <span>{report.summary.featureCount} features</span>
            <span>{report.summary.needsHumanReview} need review</span>
            <span>{report.summary.highRisk} high risk</span>
          </div>
          {packets.slice(0, 6).map((packet) => (
            <button className="review-packet" key={packet.featureId} type="button" onClick={() => setSelectedPacket(packet)}>
              <div className="review-packet-head">
                <div>
                  <span className="mono">{packet.featureId}</span>
                  <h3>{packet.title}</h3>
                </div>
                <div className="pill-row">
                  <Pill tone={actionTone[packet.suggestedAction]}>{packet.suggestedAction.replace("_", " ")}</Pill>
                  <Pill tone={toneForRisk(packet.risk ?? "low")}>{packet.risk ?? "low"}</Pill>
                </div>
              </div>
              <div className="review-packet-meta">
                <span>{packet.implementationCommit ?? packet.commit ?? "No commit"}</span>
                <span>{packet.diff?.filesChanged ?? packet.changedFiles.length} files</span>
                <span>+{packet.diff?.insertions ?? 0} / -{packet.diff?.deletions ?? 0}</span>
                <span>{packet.reviewStatus?.replace("_", " ") ?? "review unknown"}</span>
                <span>{packet.evidence.length} evidence</span>
              </div>
              {[...packet.pitfalls, ...packet.errors, ...packet.lessons].slice(0, 2).map((item) => (
                <p className="review-packet-note" key={item}>
                  {item}
                </p>
              ))}
              <div className="review-open-row">
                <FileDiff size={15} />
                Open review packet
              </div>
            </button>
          ))}
          {report.crossFeatureRisks.length > 0 && (
            <div className="mini-section">
              <strong>Cross-feature risks</strong>
              <ul>
                {report.crossFeatureRisks.slice(0, 3).map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
          {selectedPacket && (
            <ReviewPacketDialog packet={selectedPacket} actionTone={actionTone} onClose={() => setSelectedPacket(undefined)} />
          )}
        </div>
      )}
    </section>
  );
}

function ReviewPacketDialog({
  packet,
  actionTone,
  onClose
}: {
  packet: ReviewPacket;
  actionTone: Record<ReviewPacket["suggestedAction"], "good" | "warn" | "bad" | "info">;
  onClose: () => void;
}) {
  const agentReview = [...(packet.errors ?? []), ...(packet.pitfalls ?? []), ...(packet.risks ?? [])];
  const knowledge = [...(packet.decisions ?? []), ...(packet.lessons ?? []), ...(packet.fixes ?? [])];
  const coverage = packet.acceptanceCoverage ?? [];

  return (
    <div className="review-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="review-modal-header">
          <div>
            <span className="mono">{packet.featureId}</span>
            <h2 id="review-modal-title">{packet.title}</h2>
            <p>{packet.rfcIntent ?? "No RFC intent recorded."}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close review packet" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="review-modal-toolbar">
          <Pill tone={actionTone[packet.suggestedAction]}>{packet.suggestedAction.replace("_", " ")}</Pill>
          <Pill tone={toneForRisk(packet.risk ?? "low")}>{packet.risk ?? "low"}</Pill>
          <Pill tone={packet.evidenceQuality?.decision === "allow" ? "good" : packet.evidenceQuality?.decision === "block" ? "bad" : "warn"}>
            {packet.evidenceQuality?.decision.replace("_", " ") ?? "evidence unknown"}
          </Pill>
          <span>{packet.implementationCommit ?? packet.commit ?? "No commit"}</span>
          <span>{packet.historyPath ?? "No history path"}</span>
        </div>

        <div className="review-modal-grid">
          <section className="review-modal-section diff-section">
            <div className="modal-section-head">
              <h3>Code Diff</h3>
              <span>
                {packet.diff ? `${packet.diff.filesChanged} files, +${packet.diff.insertions} / -${packet.diff.deletions}` : "No diff"}
              </span>
            </div>
            {packet.diff?.stat && <pre className="diff-stat">{packet.diff.stat}</pre>}
            <pre className="diff-block">{packet.diff?.patch || "No diff recorded. Regenerate morning review after completion metadata includes a commit."}</pre>
            {packet.diff?.truncated && <p className="review-warning">Diff was truncated for review packet size.</p>}
          </section>

          <div className="review-side-stack">
            <section className="review-modal-section">
              <h3>Implementation Files</h3>
              <ReviewList items={packet.implementationFiles?.length ? packet.implementationFiles : packet.changedFiles} empty="No implementation files recorded." />
            </section>
            <section className="review-modal-section">
              <h3>State Files</h3>
              <ReviewList items={packet.stateFiles ?? []} empty="No DEVNS state files recorded." />
            </section>
            <section className="review-modal-section">
              <h3>Review Agent Notes</h3>
              <ReviewList items={agentReview} empty="No review-agent findings recorded." />
            </section>
            <section className="review-modal-section">
              <h3>Human Review Checklist</h3>
              <ReviewList
                items={[
                  "Confirm the diff matches the RFC intent.",
                  "Check changed files for unrelated scope drift.",
                  "Verify evidence covers each acceptance criterion.",
                  "Approve, request changes, or mark follow-up in the feature review card."
                ]}
              />
            </section>
            <section className="review-modal-section">
              <h3>Evidence</h3>
              <ReviewList items={packet.evidence} empty="No evidence recorded." />
            </section>
          </div>
        </div>

        <div className="review-modal-grid lower">
          <section className="review-modal-section">
            <h3>Acceptance Coverage</h3>
            {coverage.length ? (
              <div className="coverage-list">
                {coverage.map((item) => (
                  <div className="coverage-item" key={item.criterion}>
                    <strong>{item.criterion}</strong>
                    <ReviewList items={item.evidence} empty="No direct evidence mapped." />
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-copy">No acceptance coverage recorded.</p>
            )}
          </section>
          <section className="review-modal-section">
            <h3>Design Decisions And Lessons</h3>
            <ReviewList items={knowledge} empty="No durable history notes recorded." />
          </section>
        </div>
      </div>
    </div>
  );
}

function ReviewList({ items, empty = "None" }: { items: string[]; empty?: string }) {
  return items.length ? (
    <ul className="review-list">
      {items.slice(0, 10).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="empty-copy">{empty}</p>
  );
}

function OpenQuestions({ questions = [] }: { questions?: OpenQuestion[] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Open Questions</h2>
          <p>Unsettled decisions that should be reviewed before hardening the MVP.</p>
        </div>
        <Pill tone="warn">needs review</Pill>
      </div>
      <div className="question-list">
        {questions.map((question) => (
          <article className="question" key={question.id}>
            <div className="question-head">
              <div>
                <span className="mono">{question.id}</span>
                <h3>{question.title}</h3>
              </div>
              <Pill tone={question.severity === "high" ? "bad" : "warn"}>{question.severity}</Pill>
            </div>
            <div className="option-list">
              {question.options.map((option) => (
                <span key={option}>{option}</span>
              ))}
            </div>
            <p>
              <strong>Recommendation:</strong> {question.recommended}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

class DashboardErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Dashboard render failed." };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <main className="main error-screen">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h1>Dashboard State Error</h1>
                  <p>{this.state.error}</p>
                </div>
                <Pill tone="warn">recoverable</Pill>
              </div>
              <div className="command-strip">
                <Code2 size={15} aria-hidden="true" />
                <code>npx devns validate --fix --json</code>
              </div>
            </section>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

function ExtensionPoints() {
  const points: ExtensionPoint[] = [
    {
      name: "Feature inventory schema",
      kind: "core",
      description: "Stable JSON state contract for tasks, evidence, review decisions, and milestones."
    },
    {
      name: "Hook decision contract",
      kind: "core",
      description: "Provider-neutral continue, complete-and-claim-next, or stop-for-human-review decisions."
    },
    {
      name: "Requirement analysis skill",
      kind: "edge",
      description: "Project-local skill that discovers implicit requirements before coding starts."
    },
    {
      name: "Stop hook policy",
      kind: "edge",
      description: "Configurable gate thresholds for review findings, skipped checks, retries, and risk."
    },
    {
      name: "Agent commands",
      kind: "edge",
      description: "Bring Codex, Claude Code, local scripts, CI jobs, or internal agent platforms."
    },
    {
      name: "Verification sensors",
      kind: "edge",
      description: "Attach domain checks such as API compatibility, visual regression, security, or performance."
    },
    {
      name: "Evidence panels",
      kind: "edge",
      description: "Render project-specific review artifacts without forking the whole dashboard."
    }
  ];

  const core = points.filter((point) => point.kind === "core");
  const edges = points.filter((point) => point.kind === "edge");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Extension Points</h2>
          <p>DEVNS is a stable core with editable project edges.</p>
        </div>
        <Pill tone="info">second development</Pill>
      </div>
      <div className="extension-layout">
        <div className="extension-column">
          <div className="extension-title">
            <ShieldCheck size={16} />
            Stable core
          </div>
          {core.map((point) => (
            <article className="extension-item" key={point.name}>
              <strong>{point.name}</strong>
              <p>{point.description}</p>
            </article>
          ))}
        </div>
        <div className="extension-column">
          <div className="extension-title">
            <GitBranch size={16} />
            Editable edges
          </div>
          {edges.map((point) => (
            <article className="extension-item" key={point.name}>
              <strong>{point.name}</strong>
              <p>{point.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HarnessMap() {
  const steps = [
    ["Intake", "Raw requests become candidates", <FileJson2 size={17} />],
    ["Analyze", "Discover explicit and implicit requirements", <ListChecks size={17} />],
    ["Implement", "Coding agent works one feature at a time", <Code2 size={17} />],
    ["Verify", "Sensors produce structured evidence", <ShieldCheck size={17} />],
    ["Review", "HTML report focuses human attention", <LayoutDashboard size={17} />],
    ["Extend", "Plugins replace agents and panels", <Plug size={17} />]
  ] as const;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Harness Loop</h2>
          <p>The product is the loop around the agent, not another agent runner.</p>
        </div>
        <Pill tone="good">local-first</Pill>
      </div>
      <div className="loop-grid">
        {steps.map(([title, copy, icon]) => (
          <div className="loop-step" key={title}>
            <div className="loop-icon">{icon}</div>
            <strong>{title}</strong>
            <span>{copy}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Milestones({ features }: { features: Feature[] }) {
  const milestones = Object.entries(
    features.reduce<Record<string, Feature[]>>((acc, feature) => {
      acc[feature.milestone] ||= [];
      acc[feature.milestone].push(feature);
      return acc;
    }, {})
  );

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Milestones</h2>
          <p>Human-facing progress, grouped by product outcome.</p>
        </div>
      </div>
      <div className="milestone-list">
        {milestones.map(([name, items]) => {
          const done = items.filter((item) => item.status === "done").length;
          const progress = Math.round((done / items.length) * 100);
          return (
            <article className="milestone" key={name}>
              <div className="milestone-head">
                <strong>{name}</strong>
                <span>{progress}%</span>
              </div>
              <div className="progress-bar">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="milestone-meta">
                {items.length} features · {items.filter((item) => item.risk === "high").length} high risk
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function App() {
  const [view, setView] = useState<"review" | "backlog" | "extensions" | "questions">("review");
  const [data, setData] = useState<Roadmap>(fallbackData);
  const [morningReview, setMorningReview] = useState<MorningReviewReport | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const features = data.features;

  useEffect(() => {
    Promise.all([loadRoadmap(), loadLatestReview()])
      .then(([roadmap, report]) => {
        setData(roadmap);
        setMorningReview(report);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load roadmap");
      });
  }, []);

  async function updateFeature(featureId: string, patch: FeaturePatch) {
    const { feature, revision } = await patchFeature(featureId, patch, data.revision);
    setData((current) => ({
      ...current,
      revision: revision ?? current.revision,
      features: current.features.map((item) => (item.id === featureId ? feature : item))
    }));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <strong>DEVNS</strong>
            <span>Agent Harness</span>
          </div>
        </div>
        <nav aria-label="Primary">
          <button className={cx(view === "review" && "active")} type="button" onClick={() => setView("review")}>
            <LayoutDashboard size={17} />
            Review
          </button>
          <button className={cx(view === "backlog" && "active")} type="button" onClick={() => setView("backlog")}>
            <ListChecks size={17} />
            Backlog
          </button>
          <button className={cx(view === "extensions" && "active")} type="button" onClick={() => setView("extensions")}>
            <Plug size={17} />
            Extensions
          </button>
          <button className={cx(view === "questions" && "active")} type="button" onClick={() => setView("questions")}>
            <AlertTriangle size={17} />
            Questions
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <p className="eyebrow">DEVNS 1.0 review dashboard</p>
            <h1>{data.project.name}</h1>
            <p>{data.project.description}</p>
            {loadError && <p className="load-error">{loadError}</p>}
          </div>
          <div className="hero-actions">
            <a href="/docs/getting-started.md" target="_blank" rel="noreferrer">
              Getting started
            </a>
            <a href="/api/roadmap" target="_blank" rel="noreferrer">
              Feature JSON
            </a>
            <a href="/api/reviews/latest" target="_blank" rel="noreferrer">
              Latest review
            </a>
          </div>
        </header>

        <MissionSummary features={features} />
        <NextAction features={features} />

        {view === "review" && (
          <div className="layout-two">
            <div className="stack">
              <HarnessMap />
              <FeatureReview features={features} onPatchFeature={updateFeature} />
            </div>
            <div className="stack">
              <CandidatePanel candidates={data.candidates} />
              <MorningReview report={morningReview} />
              <Milestones features={features} />
              <DecisionRail sources={data.researchSources} />
            </div>
          </div>
        )}

        {view === "backlog" && <FeatureTable features={features} onPatchFeature={updateFeature} />}
        {view === "extensions" && (
          <div className="stack">
            <ExtensionPoints />
            <FeatureReview
              features={features.filter(isExtensionRelatedFeature)}
              onPatchFeature={updateFeature}
            />
          </div>
        )}
        {view === "questions" && <OpenQuestions questions={data.openQuestions} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <App />
    </DashboardErrorBoundary>
  </React.StrictMode>
);
