import type { ClaudeStopHookInput, Feature, DevnsConfig, StopHookDecision } from "./types";
import { canClaimFeature, describeRfcBlock } from "./rfc";
import { claimFeature } from "./task-queue";
import { gitStatus } from "./git";
import { appendExecutionHistory, buildChangedFileEvidence, laneResultsToChecks } from "./history";
import { laneResultsToEvidence, runReviewLanes, type LaneDefinition, type LaneResult } from "./lane-runner";
import { safeAppendStopHookTrace } from "./stop-log";
import { stopHookWorkerContinuation } from "./worker-handoff";
import {
  findBlockedReadyFeature,
  findNextReadyFeature,
  patchFeature,
  readConfig,
  readInventory
} from "./state";

function laneEvidenceDecision(summary: string) {
  const match = summary.match(/Decision:\s*(allow|warn|block|needs_human_review)/i);
  return match?.[1]?.toLowerCase();
}

function laneEvidenceFor(feature: Feature, laneId: string) {
  return (feature.evidence ?? []).filter((item) => item.type === `lane:${laneId}`);
}

function laneCompletionReasons(feature: Feature, config: DevnsConfig) {
  const reasons: string[] = [];
  for (const lane of config.reviewLanes ?? []) {
    const required = lane.required || lane.blocksCompletion;
    if (!required) {
      continue;
    }

    const evidence = laneEvidenceFor(feature, lane.id);
    if (!evidence.length) {
      reasons.push(`Required lane evidence is missing: ${lane.id}.`);
      continue;
    }

    const blocking = evidence.find((item) => {
      const decision = laneEvidenceDecision(item.summary);
      return decision === "block" || decision === "needs_human_review";
    });
    if (blocking) {
      reasons.push(`Required lane ${lane.id} is not clear to pass: ${blocking.summary}`);
    }
  }
  return reasons;
}

function hasDeterministicEvidence(feature: Feature) {
  return (feature.evidence ?? []).some((item) => {
    if (item.verificationType === "command" || item.verificationType === "static_review" || item.verificationType === "browser_smoke") {
      return true;
    }
    return item.type === "verification" || item.actor?.startsWith("lane:");
  });
}

function stopReviewAgentLanes(config: DevnsConfig, feature: Feature): LaneDefinition[] {
  if (process.env.DEVNS_STOP_AGENT_HOOK) {
    return [];
  }

  const policy = config.hooks?.stop?.reviewAgent;
  if (policy?.mode === "off") {
    return [];
  }

  if (policy?.requireDeterministicEvidence && !hasDeterministicEvidence(feature)) {
    return [];
  }

  const laneIds = new Set(policy?.laneIds ?? []);
  const hasExplicitLaneIds = laneIds.size > 0;
  return (config.reviewLanes ?? []).filter((lane) => {
    if (lane.type !== "agent" || !lane.command) {
      return false;
    }
    if (hasExplicitLaneIds ? !laneIds.has(lane.id) : !(lane.required || lane.blocksCompletion)) {
      return false;
    }
    return !laneEvidenceFor(feature, lane.id).length;
  });
}

function reviewDecisionForAgentResults(results: LaneResult[]): Feature["reviewDecision"] {
  if (results.some((result) => result.decision === "block" || result.decision === "needs_human_review" || result.status === "error")) {
    return "needs_changes";
  }

  if (results.some((result) => result.decision === "warn" || result.status === "flaky_suspected")) {
    return "follow_up";
  }

  return "approved";
}

function reviewConfidenceForAgentResults(results: LaneResult[]): NonNullable<Feature["review"]>["confidence"] {
  if (results.some((result) => result.confidence === "low")) {
    return "low";
  }

  if (results.some((result) => result.confidence === "medium")) {
    return "medium";
  }

  return "high";
}

async function runMissingReviewAgents(cwd: string, config: DevnsConfig, feature: Feature) {
  const lanes = stopReviewAgentLanes(config, feature);
  if (!lanes.length) {
    return feature;
  }

  await safeAppendStopHookTrace(cwd, {
    source: "core",
    phase: "review_agent",
    mode: "run_missing",
    selectedFeatureId: feature.id,
    laneIds: lanes.map((lane) => lane.id),
    reason: "Stop hook is running missing Review Agent lanes before making one unified decision."
  });

  const summary = await runReviewLanes({ ...config, reviewLanes: lanes }, cwd, { feature });
  const checks = laneResultsToChecks(summary.results);
  const risks = summary.results.flatMap((result) =>
    result.decision === "allow" ? [] : [`${result.lane}: ${result.summary}`]
  );
  const errors = summary.results
    .filter((result) => result.status === "error" || result.status === "fail")
    .map((result) => ({
      summary: result.summary,
      cause: `${result.lane} returned ${result.status}.`
    }));
  const history = await appendExecutionHistory(cwd, config, {
    featureId: feature.id,
    actor: "hook",
    summary: summary.blocksCompletion ? "Stop hook Review Agent found blocking results." : "Stop hook Review Agent completed.",
    decisions: ["Run missing Review Agent lanes inside the single Stop hook orchestrator before returning a unified decision."],
    alternativesRejected: ["Do not use two concurrent Stop hooks that can return conflicting continuation decisions."],
    changedFiles: buildChangedFileEvidence(feature),
    impact: [`Review Agent lanes recorded for ${feature.id}: ${lanes.map((lane) => lane.id).join(", ")}.`],
    pitfalls: [],
    errors,
    fixes: [],
    lessons: ["Review Agent lanes must return provider-neutral lane-result JSON so the Stop hook can make a deterministic final decision."],
    risks,
    dynamicChecks: checks.dynamicChecks,
    staticChecks: checks.staticChecks,
    laneResults: summary.results
  });
  const evidence = laneResultsToEvidence(summary.results);
  const reviewDecision = reviewDecisionForAgentResults(summary.results);
  const result = await patchFeature(cwd, config, feature.id, {
    evidence: [...(feature.evidence ?? []), ...evidence],
    history: history.summary,
    reviewDecision,
    review: {
      ...(feature.review ?? {}),
      confidence: reviewConfidenceForAgentResults(summary.results),
      summary: summary.blocksCompletion ? summary.continuationReason ?? "Review Agent blocked completion." : "Review Agent allowed completion.",
      risks
    }
  });

  await safeAppendStopHookTrace(cwd, {
    source: "core",
    phase: "review_agent",
    mode: summary.blocksCompletion ? "review_agent_block" : "review_agent_allow",
    selectedFeatureId: feature.id,
    laneIds: lanes.map((lane) => lane.id),
    reason: summary.continuationReason ?? "Review Agent lanes did not block completion."
  });

  return result.feature;
}

async function cleanWorktreeReasons(cwd: string, feature: Feature, config: DevnsConfig) {
  if (!config.completionPolicy?.requireCleanWorktree) {
    return [];
  }

  try {
    const dirty = await gitStatus(cwd);
    if (!dirty.length) {
      return [];
    }

    const declared = new Set([...(feature.changedFiles ?? []), ...(feature.context ?? [])]);
    const paths = dirty.map((entry) => entry.path);
    const undeclared = paths.filter((file) => !declared.has(file));
    if (undeclared.length) {
      return [`Git worktree has undeclared dirty files: ${undeclared.slice(0, 6).join(", ")}.`];
    }
    return [`Git worktree is dirty: ${paths.slice(0, 6).join(", ")}.`];
  } catch (error) {
    return [`Unable to inspect git worktree cleanliness: ${error instanceof Error ? error.message : "unknown error"}.`];
  }
}

async function completionReasons(cwd: string, feature: Feature, config: DevnsConfig) {
  const policy = config.completionPolicy ?? {};
  const reasons: string[] = [];
  const rfcReadiness = canClaimFeature({ ...feature, status: "ready" });

  if (policy.requireApprovedRfc !== false && !rfcReadiness.ready) {
    reasons.push(...rfcReadiness.reasons);
  }

  if (policy.requireEvidence !== false && !feature.evidence?.length) {
    reasons.push("No verification evidence is recorded yet.");
  }

  if (config.hooks?.stop?.blockOn?.skippedRequiredVerification !== false) {
    reasons.push(...laneCompletionReasons(feature, config));
  }

  if (policy.requireReviewDecision !== false) {
    if (!feature.reviewDecision || feature.reviewDecision === "pending") {
      reasons.push("Review decision is still pending.");
    } else if (feature.reviewDecision === "needs_changes") {
      reasons.push("Review decision requires changes before completion.");
    }
  }

  if (policy.requireCommit && !feature.commit) {
    reasons.push("No feature commit is recorded yet.");
  }

  if (policy.requireCleanWorktree && !(feature.evidence ?? []).some((item) => item.type === "git-clean")) {
    reasons.push(...(await cleanWorktreeReasons(cwd, feature, config)));
  }

  return reasons;
}

function activeContinuationReason(feature: Feature, reasons: string[]) {
  return [
    `Continue feature ${feature.id}: ${feature.title}.`,
    ...reasons,
    "Before stopping, finish the feature loop: verify, update evidence/history, record commit metadata when required, and commit exactly this feature."
  ].join(" ");
}

export async function evaluateClaudeStopHook(input: ClaudeStopHookInput): Promise<StopHookDecision> {
  const cwd = input.cwd || process.cwd();

  async function finish(
    mode: string,
    result: StopHookDecision,
    details: Partial<Parameters<typeof safeAppendStopHookTrace>[1]> = {}
  ) {
    await safeAppendStopHookTrace(cwd, {
      source: "core",
      phase: "decision",
      sessionId: input.session_id,
      hookEventName: input.hook_event_name,
      stopHookActive: input.stop_hook_active,
      decision: result.decision,
      mode,
      reason: result.reason,
      ...details
    });
    return result;
  }

  if (input.stop_hook_active) {
    return finish("recursive_allow", {
      decision: "allow",
      reason: "Stop hook is already active; allowing stop to avoid recursive blocking."
    });
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const activeFeatures = inventory.features.filter((feature) => feature.status === "in_progress");
  const readyFeatures = inventory.features.filter((feature) => feature.status === "ready");
  const traceState = {
    featureCount: inventory.features.length,
    activeFeatureIds: activeFeatures.map((feature) => feature.id),
    readyFeatureIds: readyFeatures.map((feature) => feature.id)
  };

  if (activeFeatures.length > 1) {
    return finish(
      "invalid_multiple_active",
      {
        decision: "block",
        reason: [
          "DEVNS invalid queue state: multiple features are in_progress.",
          `Active features: ${activeFeatures.map((feature) => feature.id).join(", ")}.`,
          "Resolve to exactly one active feature before continuing; DEVNS 1.0 is single-feature serial by default."
        ].join(" ")
      },
      traceState
    );
  }

  const activeFeature = activeFeatures[0];

  if (activeFeature) {
    const reviewedFeature = await runMissingReviewAgents(cwd, config, activeFeature);
    const reasons = await completionReasons(cwd, reviewedFeature, config);

    if (reasons.length) {
      return finish(
        "active_block",
        {
          decision: "block",
          reason: activeContinuationReason(reviewedFeature, reasons)
        },
        { ...traceState, selectedFeatureId: reviewedFeature.id, reasons }
      );
    }

    return finish(
      "active_allow_complete",
      {
        decision: "allow",
        reason: `Active feature ${reviewedFeature.id} satisfies completion policy.`
      },
      { ...traceState, selectedFeatureId: reviewedFeature.id }
    );
  }

  const nextFeature = findNextReadyFeature(inventory.features);

  if (!nextFeature) {
    const blockedReady = findBlockedReadyFeature(inventory.features);
    if (blockedReady) {
      const reason = [
        describeRfcBlock(blockedReady.feature, blockedReady.readiness),
        "Run the RFC clarification skill or ask the human to approve/update the RFC before claiming work."
      ].join("\n");

      if (config.completionPolicy?.whenNoClaimableFeature === "stop_for_human_review") {
        return finish(
          "blocked_ready_human_review",
          {
            decision: "block",
            reason
          },
          { ...traceState, selectedFeatureId: blockedReady.feature.id, blockedReadyFeatureIds: [blockedReady.feature.id] }
        );
      }

      return finish(
        "blocked_ready_allow",
        {
          decision: "allow",
          reason
        },
        { ...traceState, selectedFeatureId: blockedReady.feature.id, blockedReadyFeatureIds: [blockedReady.feature.id] }
      );
    }

    return finish(
      "empty_allow",
      {
        decision: "allow",
        reason: "No in-progress or ready DEVNS feature remains."
      },
      traceState
    );
  }

  if (config.completionPolicy?.whenNoActiveFeature === "allow_stop") {
    return finish(
      "claimable_allow_stop",
      {
        decision: "allow",
        reason: `Next feature ${nextFeature.id} is claimable, but completion policy allows stop when no feature is active.`
      },
      { ...traceState, selectedFeatureId: nextFeature.id }
    );
  }

  const result = await claimFeature(cwd, config, nextFeature.id, {
    by: "claude-stop-hook",
    summary: `Claimed by Claude Stop hook`
  });

  if (!result) {
    return finish(
      "claim_race_allow",
      {
        decision: "allow",
        reason: "No claimable feature remains."
      },
      traceState
    );
  }

  return finish(
    "claim_next_block",
    {
      decision: "block",
      reason: stopHookWorkerContinuation(config, result.feature, cwd)
    },
    { ...traceState, selectedFeatureId: result.feature.id }
  );
}
