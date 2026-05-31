export type FeatureStatus = "ready" | "in_progress" | "done" | "blocked" | "failed";
export type FeaturePriority = "P0" | "P1" | "P2" | "P3";
export type ReviewDecision = "pending" | "approved" | "needs_changes" | "follow_up";
export type Risk = "low" | "medium" | "high";
export type RfcStatus = "draft" | "needs_human_review" | "approved" | "needs_changes" | "blocked" | "superseded";
export type RequirementType = "explicit" | "implicit";
export type RequirementPriority = "must" | "should" | "could";
export type TestTarget = "unit" | "integration" | "e2e" | "static" | "manual";
export type VerificationType = "command" | "static_review" | "browser_smoke" | "human_review" | "review_agent";

export type Evidence = {
  type: string;
  summary: string;
  url?: string;
  actor?: string;
  producedAt?: string;
  artifactRefs?: string[];
  coversAcceptanceCriteriaIds?: string[];
  coversRequirementIds?: string[];
  verificationType?: VerificationType;
};

export type CheckRecord = {
  type: "dynamic" | "static";
  name: string;
  status: "passed" | "failed" | "skipped";
  summary: string;
  command?: string;
  exitCode?: number;
};

export type ChangedFileEvidence = {
  path: string;
  reason: string;
  acceptanceCriteria?: string[];
};

export type HumanChangeNote = {
  changedBy: string;
  changedAt: string;
  fields: string[];
  summary: string;
  reason?: string;
};

export type ExecutionIssueRecord = {
  summary: string;
  cause?: string;
  fix?: string;
  prevention?: string;
};

export type ExecutionHistoryRecord = {
  id: string;
  featureId: string;
  attempt: number;
  createdAt: string;
  actor: "agent" | "human" | "hook" | "system";
  summary: string;
  decisions: string[];
  alternativesRejected: string[];
  changedFiles: ChangedFileEvidence[];
  impact: string[];
  pitfalls: ExecutionIssueRecord[];
  errors: ExecutionIssueRecord[];
  fixes: string[];
  lessons: string[];
  risks: string[];
  dynamicChecks: CheckRecord[];
  staticChecks: CheckRecord[];
  laneResults?: unknown[];
  humanChange?: HumanChangeNote;
  followUps?: string[];
};

export type FeatureHistorySummary = {
  latestRecord?: string;
  latestSummary?: string;
  recordCount?: number;
  historyPath?: string;
};

export type FeatureArtifactRefs = {
  rfc?: string;
  evidence?: string;
  history?: string;
  review?: string;
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
  suggestedRisk?: Risk;
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
  verificationType?: VerificationType;
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

export type RfcClarificationQuestion = {
  id: string;
  question: string;
  recommended: string;
  options: string[];
  blocking: boolean;
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
  clarificationQuestions?: RfcClarificationQuestion[];
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
  artifactRefs?: FeatureArtifactRefs;
  changedFiles?: string[];
  implementationSurface?: string[];
  implementationFiles?: string[];
  stateFiles?: string[];
  history?: FeatureHistorySummary;
  commit?: string;
  implementationCommit?: string;
  metadataCommit?: string;
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
    | "artifactRefs"
    | "changedFiles"
    | "implementationSurface"
    | "implementationFiles"
    | "stateFiles"
    | "history"
    | "commit"
    | "implementationCommit"
    | "metadataCommit"
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

export type DevnsConfig = {
  $schema?: string;
  version: number;
  features: string;
  candidates?: string;
  rfcs?: string;
  history?: string;
  completionPolicy?: {
    mode?: "queue";
    whenNoActiveFeature?: "claim_next" | "allow_stop";
    whenNoClaimableFeature?: "allow_stop" | "stop_for_human_review";
    requireApprovedRfc?: boolean;
    requireEvidence?: boolean;
    requireReviewDecision?: boolean;
    requireCleanWorktree?: boolean;
    requireCommit?: boolean;
    allowEmptyOutputWhenComplete?: boolean;
    contextBudget?: {
      maxContinuationTurns?: number;
      preferFreshWorkerPerFeature?: boolean;
      handoffTokenBudget?: number;
      resetWhenHistoryRecordsExceed?: number;
    };
  };
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
      reviewAgent?: {
        mode?: "off" | "run_missing";
        laneIds?: string[];
        requireDeterministicEvidence?: boolean;
      };
    };
  };
  agents?: Record<string, unknown>;
  sensors?: Record<string, string>;
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
  extensions?: {
    skills?: Record<string, string>;
    agents?: Record<string, string>;
    policies?: Record<string, string>;
    lanes?: Record<string, string>;
    sensors?: Record<string, string>;
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
