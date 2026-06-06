import type { ArtifactDigest } from "./artifact-digest";

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
