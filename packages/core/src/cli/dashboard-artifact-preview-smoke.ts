#!/usr/bin/env node
import assert from "node:assert/strict";
import { auditDashboardArtifactPreview } from "../harness/dashboard-artifact-preview";
import type { ArtifactDigest } from "../harness/artifact-digest";

const digest: ArtifactDigest = {
  artifactRef: ".devns/artifacts/browser-smoke/PKT-001/run.json",
  kind: "browser_smoke",
  status: "warn",
  summary:
    "Browser smoke .devns/artifacts/browser-smoke/PKT-001/run.json; exit code: 0; rich artifacts: 4; screenshots: 1; traces: 1; console entries: 3; console errors: 1; network requests: 4; network failures: 1",
  browserSmoke: {
    exitCode: 0,
    richArtifactCount: 4,
    screenshots: 1,
    traces: 1,
    consoleEntries: 3,
    consoleErrors: 1,
    networkRequests: 4,
    networkFailures: 1,
    sampleUrls: ["http://127.0.0.1:5173/", "https://api.example.test/session"],
    policyFindings: ["Browser smoke console artifact contains console error(s): 1, over budget 0."]
  }
};

const richSnapshot = [
  "Artifacts 1 ref",
  "PKT-001/run.json warn",
  "1 shot 1 net fail",
  "console 1/3",
  "network 1/4",
  "traces 1",
  "http://127.0.0.1:5173/",
  "https://api.example.test/session",
  "Browser smoke console artifact contains console error(s): 1, over budget 0."
].join("\n");

const refsOnlySnapshot = "Artifacts 1 ref .devns/artifacts/browser-smoke/PKT-001/run.json";

const rich = auditDashboardArtifactPreview({ artifactDigests: [digest], visibleText: richSnapshot });
assert.equal(rich.decision, "allow");
assert.deepEqual(rich.missingTokens, []);

const refsOnly = auditDashboardArtifactPreview({ artifactDigests: [digest], visibleText: refsOnlySnapshot });
assert.equal(refsOnly.decision, "block");
assert.match(refsOnly.summary, /missing semantic token/);
assert.ok(refsOnly.missingTokens.some((token) => token.includes("console metric")));
assert.ok(refsOnly.missingTokens.some((token) => token.includes("sample URL")));

process.stdout.write("Dashboard artifact preview smoke passed.\n");
