import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveFromCwd } from "./state";
import type { Evidence, Feature } from "./types";

export type ArtifactIntegrityDecision = "allow" | "warn" | "block";

export type ArtifactIntegrityFinding = {
  severity: "warning" | "error";
  message: string;
  artifactRef?: string;
  suggestedFix?: string;
};

export type ArtifactIntegrityReport = {
  featureId: string;
  decision: ArtifactIntegrityDecision;
  summary: string;
  findings: ArtifactIntegrityFinding[];
};

type BrowserSmokeManifest = {
  schemaVersion?: unknown;
  type?: unknown;
  command?: unknown;
  exitCode?: unknown;
  artifactDir?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  artifacts?: unknown;
};

export type ArtifactIntegrityOptions = {
  requireRichBrowserArtifacts?: boolean;
  failOnConsoleError?: boolean;
  consoleErrorBudget?: number;
  failOnNetworkError?: boolean;
  networkFailureBudget?: number;
  networkFailureStatus?: number;
  networkAllowedUrls?: string[];
  networkBlockedUrls?: string[];
};

type BrowserSmokeArtifact = {
  kind?: unknown;
  path?: unknown;
  bytes?: unknown;
};

const richBrowserArtifactKinds = new Set(["screenshot", "trace", "console", "network", "video"]);

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isBrowserSmokeEvidence(evidence: Evidence) {
  return evidence.verificationType === "browser_smoke" || /browser|e2e|playwright|selenium|visual/i.test(evidence.type);
}

function isSemanticEvidence(evidence: Evidence) {
  return (
    ["browser_smoke", "human_review", "review_agent"].includes(evidence.verificationType ?? "") ||
    /browser|e2e|visual|review|human|manual/i.test(evidence.type)
  );
}

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

async function readBytes(filePath: string) {
  try {
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

function manifestString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function looksLikeImage(filePath: string, bytes: Buffer) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (lower.endsWith(".webp")) return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return true;
}

function parseJsonLines(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("empty JSONL");
  const records: unknown[] = [];
  for (const line of lines) {
    records.push(JSON.parse(line));
  }
  return records;
}

function recordsFromStructuredJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  const harEntries = asRecord(record?.log)?.entries;
  if (Array.isArray(harEntries)) return harEntries;
  if (Array.isArray(record?.entries)) return record.entries;
  return [value];
}

function parseStructuredArtifactRecords(filePath: string, value: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return parseJsonLines(value);
  return recordsFromStructuredJson(JSON.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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

function structuredValueMatches(value: unknown, predicate: (record: Record<string, unknown>) => boolean, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const record = asRecord(value);
  if (record && predicate(record)) return true;

  const nestedValues = Array.isArray(value) ? value : record ? Object.values(record) : [];
  return nestedValues.some((nested) => structuredValueMatches(nested, predicate, seen));
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

function countNetworkFailures(records: unknown[], statusThreshold: number) {
  return records.filter((record) =>
    structuredValueMatches(record, (entry) => {
      for (const field of ["status", "statusCode", "responseStatus"]) {
        const status = normalizedNumber(entry[field]);
        if (status !== undefined && status >= statusThreshold) return true;
      }
      if (entry.failed === true) return true;
      return ["failure", "error", "errorText", "failureText"].some((field) => hasFailureValue(entry[field]));
    })
  ).length;
}

function networkFailureStatus(options: ArtifactIntegrityOptions) {
  return typeof options.networkFailureStatus === "number" && options.networkFailureStatus > 0 ? options.networkFailureStatus : 500;
}

function allowedBudget(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
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

function escapeRegex(value: string) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardMatches(pattern: string, value: string) {
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "i");
  return regex.test(value);
}

function urlPatternMatches(pattern: string, value: string) {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) return false;
  if (normalizedPattern.includes("*")) return wildcardMatches(normalizedPattern, value);
  if (value.toLowerCase().includes(normalizedPattern.toLowerCase())) return true;
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === normalizedPattern.toLowerCase();
  } catch {
    return false;
  }
}

function networkUrlPolicyFindings(artifactRef: string, records: unknown[], options: ArtifactIntegrityOptions): ArtifactIntegrityFinding[] {
  const findings: ArtifactIntegrityFinding[] = [];
  const urls = Array.from(new Set(records.flatMap((record) => urlStrings(record))));
  const allowed = (options.networkAllowedUrls ?? []).filter((pattern) => pattern.trim());
  const blocked = (options.networkBlockedUrls ?? []).filter((pattern) => pattern.trim());

  if (allowed.length) {
    const unexpected = urls.filter((url) => !allowed.some((pattern) => urlPatternMatches(pattern, url)));
    if (unexpected.length) {
      findings.push({
        severity: "error",
        artifactRef,
        message: `Browser smoke network artifact ${artifactRef} contains request outside allowed URL policy: ${unexpected.slice(0, 3).join(", ")}.`
      });
    }
  }

  if (blocked.length) {
    const matched = urls.filter((url) => blocked.some((pattern) => urlPatternMatches(pattern, url)));
    if (matched.length) {
      findings.push({
        severity: "error",
        artifactRef,
        message: `Browser smoke network artifact ${artifactRef} contains request matching blocked URL policy: ${matched.slice(0, 3).join(", ")}.`
      });
    }
  }

  return findings;
}

async function validateStructuredArtifact(
  artifactRef: string,
  kind: string,
  filePath: string,
  options: ArtifactIntegrityOptions
): Promise<ArtifactIntegrityFinding[]> {
  const findings: ArtifactIntegrityFinding[] = [];
  const bytes = await readBytes(filePath);
  if (!bytes?.length) {
    return [{ severity: "error", artifactRef, message: `Browser smoke ${kind} artifact ${artifactRef} is empty.` }];
  }

  if (kind === "screenshot" && !looksLikeImage(filePath, bytes)) {
    findings.push({ severity: "error", artifactRef, message: `Browser smoke screenshot artifact ${artifactRef} does not look like a supported image.` });
  }

  if (kind === "console" || kind === "network") {
    const text = bytes.toString("utf8");
    let records: unknown[] = [];
    try {
      records = parseStructuredArtifactRecords(filePath, text);
    } catch {
      return [{ severity: "error", artifactRef, message: `Browser smoke ${kind} artifact ${artifactRef} is not valid JSON/JSONL.` }];
    }

    if (kind === "console" && options.failOnConsoleError) {
      const errorCount = countConsoleErrors(records);
      const budget = allowedBudget(options.consoleErrorBudget);
      if (errorCount > budget) {
        findings.push({ severity: "error", artifactRef, message: `Browser smoke console artifact ${artifactRef} contains console error(s): ${errorCount}, over budget ${budget}.` });
      }
    }

    if (kind === "network" && options.failOnNetworkError) {
      const failureCount = countNetworkFailures(records, networkFailureStatus(options));
      const budget = allowedBudget(options.networkFailureBudget);
      if (failureCount > budget) {
        findings.push({ severity: "error", artifactRef, message: `Browser smoke network artifact ${artifactRef} contains failed request(s): ${failureCount}, over budget ${budget}.` });
      }
    }

    if (kind === "network") {
      findings.push(...networkUrlPolicyFindings(artifactRef, records, options));
    }
  }

  return findings;
}

async function validateManifestArtifacts(
  cwd: string,
  artifactRef: string,
  manifest: BrowserSmokeManifest,
  options: ArtifactIntegrityOptions
): Promise<ArtifactIntegrityFinding[]> {
  const findings: ArtifactIntegrityFinding[] = [];
  if (manifest.artifacts === undefined) {
    if (options.requireRichBrowserArtifacts) {
      findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} has no rich artifacts.` });
    }
    return findings;
  }

  if (!Array.isArray(manifest.artifacts)) {
    return [{ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} artifacts must be an array.` }];
  }

  let richArtifactCount = 0;
  for (const artifact of manifest.artifacts as BrowserSmokeArtifact[]) {
    const kind = manifestString(artifact.kind);
    const artifactPath = manifestString(artifact.path);
    if (!kind || !artifactPath) {
      findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} has an artifact entry missing kind or path.` });
      continue;
    }
    if (richBrowserArtifactKinds.has(kind)) richArtifactCount += 1;
    if (isUrl(artifactPath)) continue;
    const resolved = resolveFromCwd(cwd, artifactPath);
    if (!(await exists(resolved))) {
      findings.push({ severity: "error", artifactRef: artifactPath, message: `Browser smoke artifact ${artifactRef} references missing ${kind}: ${artifactPath}.` });
      continue;
    }
    const size = await stat(resolved);
    if (typeof artifact.bytes === "number" && artifact.bytes !== size.size) {
      findings.push({ severity: "error", artifactRef: artifactPath, message: `Browser smoke artifact ${artifactPath} byte size does not match manifest.` });
    }
    findings.push(...(await validateStructuredArtifact(artifactPath, kind, resolved, options)));
  }

  if (options.requireRichBrowserArtifacts && richArtifactCount === 0) {
    findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} has no screenshot, trace, console, network, or video artifact.` });
  }

  return findings;
}

async function validateBrowserSmokeManifest(cwd: string, artifactRef: string, options: ArtifactIntegrityOptions): Promise<ArtifactIntegrityFinding[]> {
  if (!artifactRef.endsWith("run.json")) return [];
  const manifestPath = resolveFromCwd(cwd, artifactRef);
  const manifest = (await readJson(manifestPath)) as BrowserSmokeManifest | undefined;
  const findings: ArtifactIntegrityFinding[] = [];

  if (!manifest || typeof manifest !== "object") {
    return [
      {
        severity: "error",
        artifactRef,
        message: `Browser smoke artifact ${artifactRef} is not valid JSON.`,
        suggestedFix: "Regenerate the browser smoke artifact through .devns/adapters/browser-smoke.sh."
      }
    ];
  }

  if (manifest.schemaVersion !== 1 || manifest.type !== "browser_smoke") {
    findings.push({
      severity: "error",
      artifactRef,
      message: `Browser smoke artifact ${artifactRef} must declare schemaVersion=1 and type=browser_smoke.`,
      suggestedFix: "Use the DEVNS browser-smoke adapter so reviewers can recognize the artifact manifest."
    });
  }

  if (typeof manifest.command !== "string" || !manifest.command.trim()) {
    findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} is missing command.` });
  }

  if (typeof manifest.exitCode !== "number") {
    findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} is missing numeric exitCode.` });
  }

  const stdout = manifestString(manifest.stdout);
  const stderr = manifestString(manifest.stderr);
  for (const [kind, value] of [
    ["stdout", stdout],
    ["stderr", stderr]
  ] as const) {
    if (!value) {
      findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} is missing ${kind} path.` });
      continue;
    }
    if (!(await exists(resolveFromCwd(cwd, value)))) {
      findings.push({ severity: "error", artifactRef, message: `Browser smoke artifact ${artifactRef} references missing ${kind}: ${value}.` });
    }
  }

  if (manifestString(manifest.artifactDir)) {
    const artifactDir = resolveFromCwd(cwd, manifest.artifactDir as string);
    const manifestDir = path.dirname(manifestPath);
    if (path.resolve(artifactDir) !== path.resolve(manifestDir)) {
      findings.push({
        severity: "warning",
        artifactRef,
        message: `Browser smoke artifact ${artifactRef} artifactDir does not match the manifest directory.`
      });
    }
  }

  findings.push(...(await validateManifestArtifacts(cwd, artifactRef, manifest, options)));

  return findings;
}

export async function evaluateArtifactIntegrity(cwd: string, feature: Feature, options: ArtifactIntegrityOptions = {}): Promise<ArtifactIntegrityReport> {
  const findings: ArtifactIntegrityFinding[] = [];
  const featureRefs = Object.entries(feature.artifactRefs ?? {}).map(([kind, value]) => ({ kind, value, source: "feature" as const }));
  const evidenceRefs = (feature.evidence ?? []).flatMap((evidence) =>
    (evidence.artifactRefs ?? []).map((value) => ({ value, evidence, source: "evidence" as const }))
  );

  for (const ref of featureRefs) {
    if (isUrl(ref.value)) continue;
    if (!(await exists(resolveFromCwd(cwd, ref.value)))) {
      findings.push({ severity: "error", artifactRef: ref.value, message: `Feature artifact ref ${ref.kind}: ${ref.value} is missing.` });
    }
  }

  for (const ref of evidenceRefs) {
    if (isUrl(ref.value)) continue;
    if (!(await exists(resolveFromCwd(cwd, ref.value)))) {
      findings.push({ severity: "error", artifactRef: ref.value, message: `Evidence artifact ref ${ref.value} is missing.` });
      continue;
    }
    if (isBrowserSmokeEvidence(ref.evidence)) {
      findings.push(...(await validateBrowserSmokeManifest(cwd, ref.value, options)));
    }
  }

  for (const evidence of feature.evidence ?? []) {
    if (isSemanticEvidence(evidence) && !evidence.url && !(evidence.artifactRefs?.length ?? 0)) {
      findings.push({
        severity: "warning",
        message: `Semantic evidence ${evidence.type}: ${evidence.summary} has no artifactRefs or url.`,
        suggestedFix: "Attach a review packet, browser smoke manifest, screenshot, log, or external review URL."
      });
    }
  }

  const hasError = findings.some((finding) => finding.severity === "error");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const decision: ArtifactIntegrityDecision = hasError ? "block" : hasWarning ? "warn" : "allow";
  return {
    featureId: feature.id,
    decision,
    summary:
      decision === "allow"
        ? "Artifact integrity passed."
        : `Artifact integrity needs attention: ${findings.map((finding) => finding.message).join(" ")}`,
    findings
  };
}
