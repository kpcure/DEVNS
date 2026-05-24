export type FeatureStatus = "ready" | "in_progress" | "done" | "blocked" | "failed";
export type FeaturePriority = "P0" | "P1" | "P2" | "P3";
export type ReviewDecision = "pending" | "approved" | "needs_changes" | "follow_up";
export type Risk = "low" | "medium" | "high";
export type RfcStatus = "draft" | "needs_human_review" | "approved" | "needs_changes" | "blocked" | "superseded";
export type RequirementType = "explicit" | "implicit";
export type RequirementPriority = "must" | "should" | "could";
export type TestTarget = "unit" | "integration" | "e2e" | "static" | "manual";

export type Evidence = {
  type: string;
  summary: string;
  url?: string;
};

export type FeatureEvent = {
  type: "claimed" | "released" | "blocked" | "failed" | "completed";
  at: string;
  by?: string;
  summary: string;
};

export type CandidateFeature = {
  id: string;
  title: string;
  description: string;
  status?: "discovered" | "needs_rfc" | "rejected" | "promoted";
  sources?: string[];
  confidence?: "low" | "medium" | "high";
  suggestedPriority?: FeaturePriority;
  suggestedMilestone?: string;
  unknowns?: unknown[];
};

export type CandidateInventory = {
  $schema?: string;
  candidates: CandidateFeature[];
  notes?: string[];
};

export type RfcRequirement = {
  id: string;
  type: RequirementType;
  statement: string;
  source?: string;
  priority: RequirementPriority;
};

export type RfcAcceptanceCriterion = {
  id: string;
  requirementIds?: string[];
  statement: string;
  verification?: string;
};

export type RfcTestCase = {
  id: string;
  acceptanceCriteriaIds?: string[];
  type: TestTarget;
  scenario: string;
  expected: string;
  candidateTestName?: string;
};

export type RfcUnknown = {
  question: string;
  severity: "blocking" | "non_blocking";
  owner?: "human" | "agent";
};

export type FeatureRfc = {
  status: RfcStatus;
  summary: string;
  background: string;
  featureDescription: string;
  expectedOutcome: string;
  goals: string[];
  nonGoals: string[];
  requirements: RfcRequirement[];
  acceptanceCriteria: RfcAcceptanceCriterion[];
  validationPlan: {
    dynamic: string[];
    static: string[];
  };
  testCases: RfcTestCase[];
  unknowns?: RfcUnknown[];
  risks?: string[];
  humanDecision?: {
    status: "pending" | "approved" | "needs_changes" | "rejected";
    decidedBy?: string;
    decidedAt?: string;
    notes?: string;
  };
};

export type Feature = {
  id: string;
  title: string;
  description: string;
  status: FeatureStatus;
  priority: FeaturePriority;
  milestone: string;
  risk?: Risk;
  context?: string[];
  acceptanceCriteria: string[];
  verification?: string[];
  evidence?: Evidence[];
  changedFiles?: string[];
  commit?: string;
  reviewDecision?: ReviewDecision;
  agentNotes?: string;
  events?: FeatureEvent[];
  rfc?: FeatureRfc;
  review?: {
    confidence?: "low" | "medium" | "high";
    summary?: string;
    risks?: string[];
  };
};

export type FeaturePatch = Partial<
  Pick<
    Feature,
    | "status"
    | "priority"
    | "risk"
    | "reviewDecision"
    | "agentNotes"
    | "evidence"
    | "changedFiles"
    | "commit"
    | "review"
    | "rfc"
    | "events"
  >
>;

export type FeatureInventory = {
  $schema?: string;
  revision?: string;
  project: {
    name: string;
    description: string;
    repository?: string;
  };
  features: Feature[];
  openQuestions?: unknown[];
  researchSources?: unknown[];
};

export type NeverStopConfig = {
  $schema?: string;
  version: number;
  features: string;
  candidates?: string;
  rfcs?: string;
  history?: string;
  skills?: {
    init?: string;
    rfc?: string;
    run?: string;
    [key: string]: string | undefined;
  };
  policies?: string;
  review?: {
    mode?: "html";
    outputDir?: string;
  };
  hooks?: {
    stop?: {
      mode?: "gate";
      retryBudget?: number;
      defaultDecision?: "stop_for_human_review";
      blockOn?: Record<string, boolean>;
    };
  };
  agents?: Record<string, unknown>;
  reviewLanes?: Array<{
    id: string;
    type: "command" | "agent" | "builtin";
    command?: string;
    agent?: string;
    required?: boolean;
    blocksCompletion?: boolean;
  }>;
  ui?: {
    theme?: string;
    panels?: Array<{
      id: string;
      slot: string;
      renderer: string;
    }>;
  };
};

export type ClaudeStopHookInput = {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: "Stop" | "SubagentStop";
  stop_hook_active?: boolean;
};

export type StopHookDecision =
  | {
      decision: "allow";
      reason: string;
    }
  | {
      decision: "block";
      reason: string;
    };
