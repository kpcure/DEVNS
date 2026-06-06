#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditDashboardArtifactPreview, auditDashboardArtifactPreviewArtifacts } from "../harness/dashboard-artifact-preview";
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

const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-dashboard-preview-"));
const artifactDir = path.join(cwd, ".devns", "artifacts", "browser-smoke", "preview");
try {
  await mkdir(artifactDir, { recursive: true });
  const ref = ".devns/artifacts/browser-smoke/preview/run.json";
  await writeFile(
    path.join(artifactDir, "run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        type: "browser_smoke",
        command: "fixture",
        exitCode: 0,
        stdout: ".devns/artifacts/browser-smoke/preview/stdout.log",
        stderr: ".devns/artifacts/browser-smoke/preview/stderr.log",
        artifacts: [
          { kind: "screenshot", path: ".devns/artifacts/browser-smoke/preview/screenshot.png" },
          { kind: "trace", path: ".devns/artifacts/browser-smoke/preview/trace.zip" },
          { kind: "console", path: ".devns/artifacts/browser-smoke/preview/console.ndjson" },
          { kind: "network", path: ".devns/artifacts/browser-smoke/preview/network.ndjson" },
          { kind: "dom_snapshot", path: ".devns/artifacts/browser-smoke/preview/visible-text.txt" },
          { kind: "accessibility_snapshot", path: ".devns/artifacts/browser-smoke/preview/accessibility.json" },
          { kind: "ocr_text", path: ".devns/artifacts/browser-smoke/preview/ocr.txt" }
        ]
      },
      null,
      2
    )}\n`
  );
  await writeFile(path.join(artifactDir, "stdout.log"), "");
  await writeFile(path.join(artifactDir, "stderr.log"), "");
  await writeFile(
    path.join(artifactDir, "screenshot.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
  );
  await writeFile(path.join(artifactDir, "trace.zip"), "zip");
  await writeFile(path.join(artifactDir, "console.ndjson"), '{"type":"error","text":"known warning"}\n{"type":"log","text":"ready"}\n{"type":"log","text":"done"}\n');
  await writeFile(
    path.join(artifactDir, "network.ndjson"),
    '{"url":"http://127.0.0.1:5173/","status":200}\n{"url":"https://api.example.test/session","status":200}\n{"url":"https://api.example.test/oops","status":500}\n{"url":"http://127.0.0.1/assets","status":200}\n'
  );
  await writeFile(path.join(artifactDir, "visible-text.txt"), "preview/run.json warn\n1 shot 1 net fail\nconsole 1/3\nnetwork 1/4\n");
  await writeFile(path.join(artifactDir, "accessibility.json"), JSON.stringify({ name: "traces 1 http://127.0.0.1:5173/" }));
  await writeFile(
    path.join(artifactDir, "ocr.txt"),
    [
      "https://api.example.test/session",
      "https://api.example.test/oops",
      "Browser smoke console artifact .devns/artifacts/browser-smoke/preview/console.ndjson contains console error(s): 1, over budget 0.",
      "Browser smoke network artifact .devns/artifacts/browser-smoke/preview/network.ndjson contains failed request(s): 1, over budget 0."
    ].join("\n")
  );

  const artifactAudit = await auditDashboardArtifactPreviewArtifacts(
    cwd,
    [ref],
    {
      failOnConsoleError: true,
      failOnNetworkError: true
    },
    "Artifacts 1 ref"
  );
  assert.equal(artifactAudit.decision, "allow");
  assert.match(artifactAudit.visibleText, /Browser smoke console artifact/);
  assert.equal(artifactAudit.artifactDigests[0]?.browserSmoke?.networkFailures, 1);
} finally {
  await rm(cwd, { recursive: true, force: true });
}

process.stdout.write("Dashboard artifact preview smoke passed.\n");
