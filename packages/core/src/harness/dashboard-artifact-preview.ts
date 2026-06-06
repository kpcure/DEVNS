import { readFile } from "node:fs/promises";
import { buildArtifactDigests, type ArtifactDigest } from "./artifact-digest";
import type { ArtifactIntegrityOptions } from "./artifact-integrity";
import { resolveFromCwd } from "./state";

type TokenRequirement = {
  label: string;
  alternatives: string[];
};

export type DashboardArtifactPreviewAudit = {
  decision: "allow" | "block";
  summary: string;
  missingTokens: string[];
};

export type DashboardArtifactPreviewInput = {
  artifactDigests: ArtifactDigest[];
  visibleText: string;
};

export type DashboardArtifactPreviewArtifactAudit = DashboardArtifactPreviewAudit & {
  artifactDigests: ArtifactDigest[];
  visibleText: string;
};

export const DASHBOARD_PREVIEW_TEXT_ARTIFACT_KINDS = new Set([
  "dom_snapshot",
  "accessibility_snapshot",
  "ocr_text",
  "visible_text",
  "semantic_snapshot"
]);

type BrowserSmokeManifest = {
  type?: unknown;
  artifacts?: unknown;
};

type BrowserSmokeArtifact = {
  kind?: unknown;
  path?: unknown;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function artifactRefLabel(ref: string) {
  const parts = ref.split("/");
  return parts.length > 3 ? `${parts.at(-2)}/${parts.at(-1)}` : ref;
}

function requirement(label: string, ...alternatives: string[]): TokenRequirement {
  return { label, alternatives: alternatives.filter(Boolean) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function extractStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  return (Array.isArray(value) ? value : Object.values(value)).flatMap((item) => extractStrings(item, seen));
}

async function readSemanticSnapshotArtifact(cwd: string, artifactPath: string) {
  const content = await readFile(resolveFromCwd(cwd, artifactPath), "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    const strings = extractStrings(parsed);
    return strings.length ? strings.join("\n") : content;
  } catch {
    return content;
  }
}

async function browserSmokeSemanticSnapshotText(cwd: string, artifactRef: string) {
  const manifest = JSON.parse(await readFile(resolveFromCwd(cwd, artifactRef), "utf8")) as BrowserSmokeManifest;
  if (manifest.type !== "browser_smoke" || !Array.isArray(manifest.artifacts)) return "";

  const snapshotArtifacts = (manifest.artifacts as unknown[])
    .map((artifact) => asRecord(artifact))
    .filter(
      (artifact): artifact is { kind: string; path: string } =>
        typeof artifact?.kind === "string" && DASHBOARD_PREVIEW_TEXT_ARTIFACT_KINDS.has(artifact.kind) && typeof artifact.path === "string"
    );
  const texts = await Promise.all(snapshotArtifacts.map((artifact) => readSemanticSnapshotArtifact(cwd, artifact.path).catch(() => "")));
  return texts.filter(Boolean).join("\n");
}

function browserSmokeRequirements(digest: ArtifactDigest): TokenRequirement[] {
  const browserSmoke = digest.browserSmoke;
  const common = [
    requirement(`${digest.artifactRef} status`, digest.status),
    requirement(`${digest.artifactRef} label`, artifactRefLabel(digest.artifactRef), digest.artifactRef)
  ];

  if (!browserSmoke) {
    return common.concat(requirement(`${digest.artifactRef} summary`, digest.summary));
  }

  return common.concat([
    requirement(`${digest.artifactRef} screenshot count`, `${browserSmoke.screenshots} shot`, `screenshots: ${browserSmoke.screenshots}`),
    requirement(
      `${digest.artifactRef} compact network failure count`,
      `${browserSmoke.networkFailures} net fail`,
      `network failures: ${browserSmoke.networkFailures}`
    ),
    requirement(`${digest.artifactRef} console label`, "console"),
    requirement(`${digest.artifactRef} console metric`, `${browserSmoke.consoleErrors}/${browserSmoke.consoleEntries}`),
    requirement(`${digest.artifactRef} network label`, "network"),
    requirement(`${digest.artifactRef} network metric`, `${browserSmoke.networkFailures}/${browserSmoke.networkRequests}`),
    requirement(`${digest.artifactRef} trace metric`, `traces ${browserSmoke.traces}`, `traces: ${browserSmoke.traces}`),
    ...browserSmoke.sampleUrls.slice(0, 3).map((url) => requirement(`${digest.artifactRef} sample URL ${url}`, url)),
    ...browserSmoke.policyFindings.slice(0, 3).map((finding) => requirement(`${digest.artifactRef} policy finding`, finding))
  ]);
}

export function dashboardArtifactPreviewRequirements(artifactDigests: ArtifactDigest[]) {
  return artifactDigests.flatMap((digest) =>
    digest.kind === "browser_smoke"
      ? browserSmokeRequirements(digest)
      : [
          requirement(`${digest.artifactRef} status`, digest.status),
          requirement(`${digest.artifactRef} label`, artifactRefLabel(digest.artifactRef), digest.artifactRef),
          ...(digest.bytes === undefined ? [] : [requirement(`${digest.artifactRef} bytes`, String(digest.bytes), digest.bytes.toLocaleString())])
        ]
  );
}

export function auditDashboardArtifactPreview(input: DashboardArtifactPreviewInput): DashboardArtifactPreviewAudit {
  if (!input.artifactDigests.length) {
    return {
      decision: "block",
      summary: "Dashboard artifact preview has no artifact digests to validate.",
      missingTokens: ["artifact digests"]
    };
  }

  const visible = normalize(input.visibleText);
  const missingTokens = dashboardArtifactPreviewRequirements(input.artifactDigests)
    .filter((item) => !item.alternatives.some((token) => visible.includes(normalize(token))))
    .map((item) => item.label);

  if (missingTokens.length) {
    return {
      decision: "block",
      summary: `Dashboard artifact preview missing semantic token(s): ${missingTokens.join(", ")}.`,
      missingTokens
    };
  }

  return {
    decision: "allow",
    summary: `Dashboard artifact preview passed for ${input.artifactDigests.length} artifact digest(s).`,
    missingTokens: []
  };
}

export async function readDashboardArtifactPreviewText(cwd: string, artifactRefs: string[]) {
  const texts = await Promise.all(
    [...new Set(artifactRefs.filter((ref) => ref.endsWith("run.json")))].map((artifactRef) =>
      browserSmokeSemanticSnapshotText(cwd, artifactRef).catch(() => "")
    )
  );
  return texts.filter(Boolean).join("\n");
}

export async function auditDashboardArtifactPreviewArtifacts(
  cwd: string,
  artifactRefs: string[],
  options: ArtifactIntegrityOptions = {},
  visibleText = ""
): Promise<DashboardArtifactPreviewArtifactAudit> {
  const artifactDigests = await buildArtifactDigests(cwd, artifactRefs, options);
  const snapshotText = await readDashboardArtifactPreviewText(cwd, artifactRefs);
  const combinedText = [visibleText, snapshotText].filter(Boolean).join("\n");
  const audit = auditDashboardArtifactPreview({ artifactDigests, visibleText: combinedText });
  return {
    ...audit,
    artifactDigests,
    visibleText: combinedText
  };
}
