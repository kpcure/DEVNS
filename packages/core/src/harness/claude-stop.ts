import type { ClaudeStopHookInput, Feature, NeverStopConfig, StopHookDecision } from "./types";
import { canClaimFeature, describeRfcBlock } from "./rfc";
import { claimFeature } from "./task-queue";
import {
  findActiveFeature,
  findBlockedReadyFeature,
  findNextReadyFeature,
  readConfig,
  readInventory
} from "./state";

function completionReasons(feature: Feature, config: NeverStopConfig) {
  const policy = config.completionPolicy ?? {};
  const reasons: string[] = [];
  const rfcReadiness = canClaimFeature({ ...feature, status: "ready" });

  if (policy.requireApprovedRfc !== false && !rfcReadiness.ready) {
    reasons.push(...rfcReadiness.reasons);
  }

  if (policy.requireEvidence !== false && !feature.evidence?.length) {
    reasons.push("No verification evidence is recorded yet.");
  }

  if (policy.requireReviewDecision !== false && (!feature.reviewDecision || feature.reviewDecision === "pending")) {
    reasons.push("Review decision is still pending.");
  }

  if (policy.requireCommit && !feature.commit) {
    reasons.push("No feature commit is recorded yet.");
  }

  if (policy.requireCleanWorktree && !(feature.evidence ?? []).some((item) => item.type === "git-clean")) {
    reasons.push("Clean worktree evidence is missing.");
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
  const activeFeature = findActiveFeature(inventory.features);

  if (activeFeature) {
    const reasons = completionReasons(activeFeature, config);

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
      reason: "No in-progress or ready Never Stop feature remains."
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
    reason: [
      `Claimed next feature ${result.feature.id}: ${result.feature.title}.`,
      "Do not stop yet.",
      "Read its context, run requirement analysis before coding, then implement and verify this feature."
    ].join(" ")
  };
}
