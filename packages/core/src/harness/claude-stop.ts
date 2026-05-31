import type { ClaudeStopHookInput, Feature, DevnsConfig, StopHookDecision } from "./types";
import { canClaimFeature, describeRfcBlock } from "./rfc";
import { claimFeature } from "./task-queue";
import { gitStatus } from "./git";
import { stopHookWorkerContinuation } from "./worker-handoff";
import {
  findBlockedReadyFeature,
  findNextReadyFeature,
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

  if (policy.requireReviewDecision !== false && (!feature.reviewDecision || feature.reviewDecision === "pending")) {
    reasons.push("Review decision is still pending.");
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

  if (input.stop_hook_active) {
    return {
      decision: "allow",
      reason: "Stop hook is already active; allowing stop to avoid recursive blocking."
    };
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);
  const activeFeatures = inventory.features.filter((feature) => feature.status === "in_progress");

  if (activeFeatures.length > 1) {
    return {
      decision: "block",
      reason: [
        "DEVNS invalid queue state: multiple features are in_progress.",
        `Active features: ${activeFeatures.map((feature) => feature.id).join(", ")}.`,
        "Resolve to exactly one active feature before continuing; DEVNS 1.0 is single-feature serial by default."
      ].join(" ")
    };
  }

  const activeFeature = activeFeatures[0];

  if (activeFeature) {
    const reasons = await completionReasons(cwd, activeFeature, config);

    if (reasons.length) {
      return {
        decision: "block",
        reason: activeContinuationReason(activeFeature, reasons)
      };
    }

    return {
      decision: "allow",
      reason: `Active feature ${activeFeature.id} satisfies completion policy.`
    };
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
        return {
          decision: "block",
          reason
        };
      }

      return {
        decision: "allow",
        reason
      };
    }

    return {
      decision: "allow",
      reason: "No in-progress or ready DEVNS feature remains."
    };
  }

  if (config.completionPolicy?.whenNoActiveFeature === "allow_stop") {
    return {
      decision: "allow",
      reason: `Next feature ${nextFeature.id} is claimable, but completion policy allows stop when no feature is active.`
    };
  }

  const result = await claimFeature(cwd, config, nextFeature.id, {
    by: "claude-stop-hook",
    summary: `Claimed by Claude Stop hook`
  });

  if (!result) {
    return {
      decision: "allow",
      reason: "No claimable feature remains."
    };
  }

  return {
    decision: "block",
    reason: stopHookWorkerContinuation(config, result.feature, cwd)
  };
}
