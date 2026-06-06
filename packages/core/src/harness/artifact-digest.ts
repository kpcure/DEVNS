import { access, readFile, stat } from "node:fs/promises";
import { evaluateArtifactIntegrity, type ArtifactIntegrityOptions } from "./artifact-integrity";
import { resolveFromCwd } from "./state";
import type { Feature } from "./types";

export type ArtifactDigestStatus = "ok" | "warn" | "missing";

export type ArtifactDigest = {
  artifactRef: string;
  kind: "browser_smoke" | "file";
  status: ArtifactDigestStatus;
  summary: string;
  bytes?: number;
  browserSmoke?: {
    exitCode?: number;
    richArtifactCount: number;
    screenshots: number;
    traces: number;
    consoleEntries: number;
    consoleErrors: number;
    networkRequests: number;
    networkFailures: number;
    sampleUrls: string[];
    policyFindings: string[];
  };
};

type BrowserSmokeManifest = {
  type?: unknown;
  exitCode?: unknown;
  artifacts?: unknown;
};

type BrowserSmokeArtifact = {
  kind?: unknown;
  path?: unknown;
  bytes?: unknown;
};

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function manifestString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseJsonLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function recordsFromStructuredText(filePath: string, value: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return parseJsonLines(value);
  const parsed = JSON.parse(value) as unknown;
  if (Array.isArray(parsed)) return parsed;
  const record = asRecord(parsed);
  const harEntries = asRecord(record?.log)?.entries;
  if (Array.isArray(harEntries)) return harEntries;
  if (Array.isArray(record?.entries)) return record.entries;
  return [parsed];
}

function structuredValueMatches(value: unknown, predicate: (record: Record<string, unknown>) => boolean, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const record = asRecord(value);
  if (record && predicate(record)) return true;

  const nestedValues = Array.isArray(value) ? value : record ? Object.values(record) : [];
  return nestedValues.some((nested) => structuredValueMatches(nested, predicate, seen));
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function normalizedNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function countConsoleErrors(records: unknown[]) {
  const errorTokens = new Set(["error", "exception", "pageerror", "uncaught"]);
  return records.filter((record) =>
    structuredValueMatches(record, (entry) =>
      ["type", "level", "severity", "name"].some((field) => {
        const value = normalizedString(entry[field]);
        return value ? errorTokens.has(value) : false;
      })
    )
  ).length;
}

function hasFailureValue(value: unknown) {
  if (value === true) return true;
  if (typeof value === "string") return Boolean(value.trim());
  return typeof value === "object" && value !== null;
}

function countNetworkFailures(records: unknown[]) {
  return records.filter((record) =>
    structuredValueMatches(record, (entry) => {
      for (const field of ["status", "statusCode", "responseStatus"]) {
        const status = normalizedNumber(entry[field]);
        if (status !== undefined && status >= 500) return true;
      }
      if (entry.failed === true) return true;
      return ["failure", "error", "errorText", "failureText"].some((field) => hasFailureValue(entry[field]));
    })
  ).length;
}

function urlStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value !== "object" || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) return value.flatMap((item) => urlStrings(item, seen));
  const record = value as Record<string, unknown>;
  const current = typeof record.url === "string" && record.url.trim() ? [record.url.trim()] : [];
  return current.concat(Object.values(record).flatMap((item) => urlStrings(item, seen)));
}

async function parseStructuredArtifact(cwd: string, artifactPath: string) {
  const resolved = resolveFromCwd(cwd, artifactPath);
  try {
    return recordsFromStructuredText(artifactPath, await readFile(resolved, "utf8"));
  } catch {
    return [];
  }
}

function artifactIntegrityFeature(artifactRef: string): Feature {
  return {
    id: "ARTIFACT-DIGEST",
    title: "Artifact digest",
    description: "Temporary feature used to inspect artifact integrity.",
    status: "done",
    priority: "P3",
    milestone: "Artifact Digest",
    acceptanceCriteria: ["Artifact is inspectable."],
    evidence: [
      {
        type: "browser",
        summary: "Browser smoke artifact.",
        verificationType: "browser_smoke",
        artifactRefs: [artifactRef]
      }
    ]
  };
}

async function browserSmokeDigest(cwd: string, artifactRef: string, options: ArtifactIntegrityOptions): Promise<ArtifactDigest> {
  const manifestPath = resolveFromCwd(cwd, artifactRef);
  if (!(await exists(manifestPath))) {
    return {
      artifactRef,
      kind: "browser_smoke",
      status: "missing",
      summary: `Missing browser smoke artifact: ${artifactRef}`
    };
  }

  const manifest = (await readJson(manifestPath)) as BrowserSmokeManifest | undefined;
  if (!manifest || manifest.type !== "browser_smoke" || !Array.isArray(manifest.artifacts)) {
    const size = await stat(manifestPath).catch(() => undefined);
    return {
      artifactRef,
      kind: "browser_smoke",
      status: "warn",
      bytes: size?.size,
      summary: `Browser smoke artifact ${artifactRef} has no inspectable rich artifact manifest.`
    };
  }

  let screenshots = 0;
  let traces = 0;
  let consoleEntries = 0;
  let consoleErrors = 0;
  let networkRequests = 0;
  let networkFailures = 0;
  const urls: string[] = [];

  for (const artifact of manifest.artifacts as BrowserSmokeArtifact[]) {
    const kind = manifestString(artifact.kind);
    const artifactPath = manifestString(artifact.path);
    if (!kind || !artifactPath) continue;

    if (kind === "screenshot") screenshots += 1;
    if (kind === "trace") traces += 1;
    if (kind === "console") {
      const records = await parseStructuredArtifact(cwd, artifactPath);
      consoleEntries += records.length;
      consoleErrors += countConsoleErrors(records);
    }
    if (kind === "network") {
      const records = await parseStructuredArtifact(cwd, artifactPath);
      networkRequests += records.length;
      networkFailures += countNetworkFailures(records);
      urls.push(...records.flatMap((record) => urlStrings(record)));
    }
  }

  const integrity = await evaluateArtifactIntegrity(cwd, artifactIntegrityFeature(artifactRef), options);
  const policyFindings = integrity.findings.map((finding) => finding.message);
  const richArtifactCount = manifest.artifacts.length;
  const status: ArtifactDigestStatus = integrity.decision === "allow" ? "ok" : "warn";
  const summary = [
    `Browser smoke ${artifactRef}`,
    `exit code: ${typeof manifest.exitCode === "number" ? manifest.exitCode : "unknown"}`,
    `rich artifacts: ${richArtifactCount}`,
    `screenshots: ${screenshots}`,
    `traces: ${traces}`,
    `console entries: ${consoleEntries}`,
    `console errors: ${consoleErrors}`,
    `network requests: ${networkRequests}`,
    `network failures: ${networkFailures}`
  ].join("; ");

  return {
    artifactRef,
    kind: "browser_smoke",
    status,
    summary,
    browserSmoke: {
      exitCode: typeof manifest.exitCode === "number" ? manifest.exitCode : undefined,
      richArtifactCount,
      screenshots,
      traces,
      consoleEntries,
      consoleErrors,
      networkRequests,
      networkFailures,
      sampleUrls: [...new Set(urls)].slice(0, 5),
      policyFindings
    }
  };
}

async function fileDigest(cwd: string, artifactRef: string): Promise<ArtifactDigest> {
  const resolved = resolveFromCwd(cwd, artifactRef);
  const size = await stat(resolved).catch(() => undefined);
  if (!size) {
    return {
      artifactRef,
      kind: "file",
      status: "missing",
      summary: `Missing artifact: ${artifactRef}`
    };
  }
  return {
    artifactRef,
    kind: "file",
    status: "ok",
    bytes: size.size,
    summary: `Artifact ${artifactRef}; bytes: ${size.size}`
  };
}

export async function buildArtifactDigests(cwd: string, artifactRefs: string[], options: ArtifactIntegrityOptions = {}) {
  const uniqueRefs = [...new Set(artifactRefs.filter(Boolean))];
  return Promise.all(
    uniqueRefs.map((artifactRef) => (artifactRef.endsWith("run.json") ? browserSmokeDigest(cwd, artifactRef, options) : fileDigest(cwd, artifactRef)))
  );
}
