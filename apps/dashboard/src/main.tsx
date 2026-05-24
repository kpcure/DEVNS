import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Code2,
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
  TestTube2
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
  review: {
    confidence: "low" | "medium" | "high";
    summary: string;
    risks: string[];
  };
  reviewDecision: "pending" | "approved" | "needs_changes" | "follow_up";
  agentNotes: string;
  rfc?: FeatureRfc;
};

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

type ExtensionPoint = {
  name: string;
  kind: "core" | "edge";
  description: string;
};

type Roadmap = {
  project: {
    name: string;
    description: string;
    repository: string;
  };
  features: Feature[];
  openQuestions: OpenQuestion[];
  researchSources: Source[];
};

const fallbackData: Roadmap = {
  project: {
    name: "Never Stop Harness",
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

type FeaturePatch = Partial<Pick<Feature, "status" | "priority" | "reviewDecision" | "agentNotes">>;

async function loadRoadmap() {
  const response = await fetch("/api/roadmap");
  if (!response.ok) {
    throw new Error(`Failed to load roadmap: ${response.status}`);
  }
  return (await response.json()) as Roadmap;
}

async function patchFeature(featureId: string, patch: FeaturePatch) {
  const response = await fetch(`/api/features/${encodeURIComponent(featureId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to save ${featureId}`);
  }

  return (await response.json()) as { feature: Feature };
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

function DecisionRail({ sources }: { sources: Source[] }) {
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
        {sources.map((source) => (
          <a className="decision-item" href={source.url} key={source.title} target="_blank" rel="noreferrer">
            <div>
              <strong>{source.title}</strong>
              <p>{source.takeaway}</p>
            </div>
            <ChevronDown className="external-icon" size={16} aria-hidden="true" />
          </a>
        ))}
      </div>
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
          <p>Dogfood feature inventory for building Never Stop with Never Stop.</p>
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
        <span>{savingId ? `Saving ${savingId} to JSON...` : "Edits save back to .workbench/dogfood/features.json"}</span>
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

function FeatureReview({ features }: { features: Feature[] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Feature Review Cards</h2>
          <p>Each task shows intent, evidence, risks, and verification commands.</p>
        </div>
        <Pill tone="neutral">one feature per commit</Pill>
      </div>
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
                {feature.commit || "No commit yet"}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OpenQuestions({ questions }: { questions: OpenQuestion[] }) {
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
          <p>Never Stop is a stable core with editable project edges.</p>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const features = data.features;

  useEffect(() => {
    loadRoadmap()
      .then((roadmap) => {
        setData(roadmap);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "Unable to load roadmap");
      });
  }, []);

  async function updateFeature(featureId: string, patch: FeaturePatch) {
    const { feature } = await patchFeature(featureId, patch);
    setData((current) => ({
      ...current,
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
            <strong>Never Stop</strong>
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
            <p className="eyebrow">Dogfood dashboard</p>
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
          </div>
        </header>

        <MissionSummary features={features} />

        {view === "review" && (
          <div className="layout-two">
            <div className="stack">
              <HarnessMap />
              <FeatureReview features={features} />
            </div>
            <div className="stack">
              <Milestones features={features} />
              <DecisionRail sources={data.researchSources} />
            </div>
          </div>
        )}

        {view === "backlog" && <FeatureTable features={features} onPatchFeature={updateFeature} />}
        {view === "extensions" && (
          <div className="stack">
            <ExtensionPoints />
            <FeatureReview features={features.filter((feature) => feature.id === "NS-007" || feature.id === "NS-006" || feature.id === "NS-002")} />
          </div>
        )}
        {view === "questions" && <OpenQuestions questions={data.openQuestions} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
