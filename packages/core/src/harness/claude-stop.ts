import type { ClaudeStopHookInput, StopHookDecision } from "./types";
import { describeRfcBlock } from "./rfc";
import { claimFeature } from "./task-queue";
import {
  findActiveFeature,
  findBlockedReadyFeature,
  findNextReadyFeature,
  readConfig,
  readInventory
} from "./state";

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
    const missingEvidence = !activeFeature.evidence?.length;
    const pendingReview = !activeFeature.reviewDecision || activeFeature.reviewDecision === "pending";

    if (missingEvidence || pendingReview) {
      return {
        decision: "block",
        reason: [
          `Continue feature ${activeFeature.id}: ${activeFeature.title}.`,
          missingEvidence ? "No verification evidence is recorded yet." : "",
          pendingReview ? "Review decision is still pending." : "",
          "Before stopping, run the configured verification/review lanes and update the feature JSON."
        ]
          .filter(Boolean)
          .join(" ")
      };
    }

    return {
      decision: "allow",
      reason: `Active feature ${activeFeature.id} has evidence and a review decision.`
    };
  }

  const nextFeature = findNextReadyFeature(inventory.features);

  if (!nextFeature) {
    const blockedReady = findBlockedReadyFeature(inventory.features);
    if (blockedReady) {
      return {
        decision: "block",
        reason: [
          describeRfcBlock(blockedReady.feature, blockedReady.readiness),
          "Run the RFC clarification skill or ask the human to approve/update the RFC before claiming work."
        ].join("\n")
      };
    }

    return {
      decision: "allow",
      reason: "No in-progress or ready Never Stop feature remains."
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
