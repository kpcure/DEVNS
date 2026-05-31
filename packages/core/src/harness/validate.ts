import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import candidatesSchema from "../../../../tools/schema/candidates.schema.json";
import rfcSchema from "../../../../tools/schema/rfc.schema.json";
import laneResultSchema from "../../../../tools/schema/lane-result.schema.json";
import { evaluateClaudeStopHook } from "./claude-stop";
import { defaultConfig } from "./config";
import { historyPathForFeature, readExecutionHistoryRecords } from "./history";
import { readLatestMorningReview } from "./morning-review";
import { evaluateEvidenceQuality } from "./evidence-quality";
import { evaluateRfcReadiness } from "./rfc";
import { readCandidates, readConfig, readInventory, readJsonFile, resolveFromCwd } from "./state";
import { validateSchema } from "./schema-validator";
import type { DevnsConfig, Feature, FeatureInventory } from "./types";

export type ValidationStatus = "pass" | "warn" | "fail";

export type ValidationCheck = {
  id: string;
  category: "workspace" | "state" | "lane" | "hook" | "review" | "knowledge" | "command";
  status: ValidationStatus;
  summary: string;
  details?: string[];
  suggestedFix?: string;
};

export type HarnessValidationOptions = {
  strict?: boolean;
  fix?: boolean;
};

export type HarnessValidationReport = {
  status: ValidationStatus;
  strict: boolean;
  fixed: string[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  checks: ValidationCheck[];
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

function check(
  checks: ValidationCheck[],
  category: ValidationCheck["category"],
  id: string,
  status: ValidationStatus,
  summary: string,
  details?: string[],
  suggestedFix?: string
) {
  checks.push({ id, category, status, summary, details, suggestedFix });
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(cwd: string, dirPath: string, options: HarnessValidationOptions, fixed: string[]) {
  const resolved = resolveFromCwd(cwd, dirPath);
  if (await exists(resolved)) return true;
  if (options.fix) {
    await mkdir(resolved, { recursive: true });
    fixed.push(path.relative(cwd, resolved));
    return true;
  }
  return false;
}

function packageScript(packageJson: { scripts?: Record<string, string> }, name: string) {
  return packageJson.scripts?.[name];
}

async function readPackageJson(cwd: string) {
  try {
    return await readJsonFile<{
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(cwd, "package.json"));
  } catch {
    return { scripts: {} };
  }
}

function laneEvidenceDecision(summary: string) {
  const match = summary.match(/Decision:\s*(allow|warn|block|needs_human_review)/i);
  return match?.[1]?.toLowerCase();
}

function requiredLanes(config: DevnsConfig) {
  return (config.reviewLanes ?? []).filter((lane) => lane.required || lane.blocksCompletion);
}

function laneEvidenceFor(feature: Feature, laneId: string) {
  return (feature.evidence ?? []).filter((item) => item.type === `lane:${laneId}`);
}

function artifactPathExists(cwd: string, maybePath?: string) {
  return maybePath ? exists(resolveFromCwd(cwd, maybePath)) : Promise.resolve(true);
}

async function validateWorkspace(
  cwd: string,
  config: DevnsConfig,
  options: HarnessValidationOptions,
  fixed: string[],
  checks: ValidationCheck[]
) {
  const workspaceDirs = [
    ".devns",
    config.rfcs ?? defaultConfig.rfcs ?? ".devns/rfcs",
    config.history ?? defaultConfig.history ?? ".devns/history",
    config.review?.outputDir ?? defaultConfig.review?.outputDir ?? ".devns/reviews",
    config.policies ?? defaultConfig.policies ?? ".devns/policies",
    ".devns/skills",
    ".devns/agents",
    ".devns/lanes",
    ".devns/sensors"
  ];

  for (const dir of workspaceDirs) {
    const present = await ensureDir(cwd, dir, options, fixed);
    check(
      checks,
      "workspace",
      `workspace.dir.${dir.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      present ? "pass" : "warn",
      present ? `${dir} exists.` : `${dir} is missing.`,
      undefined,
      `Create ${dir} or run harness:validate -- --fix.`
    );
  }

  const agentsPath = path.join(cwd, "AGENTS.md");
  const agents = (await exists(agentsPath)) ? await readFile(agentsPath, "utf8") : "";
  check(
    checks,
    "workspace",
    "workspace.agents",
    agents.includes("<!-- devns:start -->") && agents.includes("<!-- devns:end -->") ? "pass" : "warn",
    agents ? "AGENTS.md contains DEVNS protocol markers." : "AGENTS.md is missing.",
    agents && !agents.includes("<!-- devns:start -->") ? ["DEVNS section markers were not found."] : undefined,
    "Run devns:init or add the generated DEVNS section."
  );

  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignore = (await exists(gitignorePath)) ? await readFile(gitignorePath, "utf8") : "";
  const missingIgnores = [".devns", ".codex"].filter((item) => !gitignore.includes(item));
  check(
    checks,
    "workspace",
    "workspace.gitignore",
    missingIgnores.length ? "warn" : "pass",
    missingIgnores.length ? `.gitignore does not mention ${missingIgnores.join(", ")}.` : ".gitignore mentions DEVNS local state.",
    missingIgnores.length ? missingIgnores : undefined,
    "Ignore local harness state unless this repository intentionally tracks it; this check is advisory and is not changed by --fix."
  );
}

async function validateState(cwd: string, config: DevnsConfig, inventory: FeatureInventory, checks: ValidationCheck[], strict = false) {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const feature of inventory.features) {
    if (ids.has(feature.id)) duplicates.push(feature.id);
    ids.add(feature.id);
  }
  check(
    checks,
    "state",
    "state.feature_ids_unique",
    duplicates.length ? "fail" : "pass",
    duplicates.length ? `Duplicate feature ids: ${duplicates.join(", ")}.` : "Feature ids are unique.",
    duplicates
  );

  const active = inventory.features.filter((feature) => feature.status === "in_progress");
  check(
    checks,
    "state",
    "state.single_active_feature",
    active.length > 1 ? "fail" : "pass",
    active.length > 1 ? `Multiple active features: ${active.map((feature) => feature.id).join(", ")}.` : "At most one feature is active.",
    active.map((feature) => feature.id)
  );

  for (const feature of inventory.features) {
    if (feature.status === "ready" || feature.status === "done" || feature.status === "in_progress") {
      const readiness = evaluateRfcReadiness({ ...feature, status: "ready" });
      check(
        checks,
        "state",
        `state.rfc.${feature.id}`,
        readiness.ready ? "pass" : feature.status === "ready" ? "fail" : "warn",
        readiness.ready ? `${feature.id} RFC is approved and covered.` : `${feature.id} RFC is not fully ready.`,
        readiness.ready ? undefined : readiness.reasons
      );
    }

    if (feature.status === "done") {
      check(
        checks,
        "state",
        `state.done_evidence.${feature.id}`,
        feature.evidence?.length ? "pass" : "fail",
        feature.evidence?.length ? `${feature.id} has evidence.` : `${feature.id} is done but has no evidence.`
      );
      const evidenceQuality = evaluateEvidenceQuality(feature);
      check(
        checks,
        "state",
        `state.evidence_quality.${feature.id}`,
        evidenceQuality.decision === "block" && strict ? "fail" : evidenceQuality.decision === "allow" ? "pass" : "warn",
        evidenceQuality.summary,
        evidenceQuality.findings.map((finding) => finding.message)
      );
      check(
        checks,
        "state",
        `state.done_review.${feature.id}`,
        feature.reviewDecision && feature.reviewDecision !== "pending" ? "pass" : "fail",
        feature.reviewDecision && feature.reviewDecision !== "pending"
          ? `${feature.id} has review decision ${feature.reviewDecision}.`
          : `${feature.id} is done but reviewDecision is pending or missing.`
      );
      if (config.completionPolicy?.requireCommit !== false) {
        const implementationCommit = feature.implementationCommit ?? feature.commit;
        check(
          checks,
          "state",
          `state.done_commit.${feature.id}`,
          implementationCommit ? "pass" : "warn",
          implementationCommit
            ? `${feature.id} records implementation commit ${implementationCommit}.`
            : `${feature.id} is done but commit is missing; this is allowed for legacy records but blocks strict audit.`
        );
      }
      check(
        checks,
        "state",
        `state.done_changed_files.${feature.id}`,
        feature.changedFiles?.length ? "pass" : "warn",
        feature.changedFiles?.length
          ? `${feature.id} records changed files.`
          : `${feature.id} is done but changedFiles is empty; this is only expected for explicit no-code/manual features.`
      );
    }

    const refs = feature.artifactRefs;
    if (refs) {
      const missing: string[] = [];
      for (const [kind, value] of Object.entries(refs)) {
        if (!(await artifactPathExists(cwd, value))) missing.push(`${kind}: ${value}`);
      }
      check(
        checks,
        "state",
        `state.artifact_refs.${feature.id}`,
        missing.length ? "fail" : "pass",
        missing.length ? `${feature.id} has missing artifact refs.` : `${feature.id} artifact refs resolve.`,
        missing
      );
    }
  }

  try {
    const candidates = await readCandidates(cwd, config);
    const result = validateSchema(candidates, candidatesSchema);
    check(
      checks,
      "state",
      "state.candidates_schema",
      result.valid ? "pass" : "fail",
      result.valid ? "Candidate inventory schema is valid." : "Candidate inventory schema is invalid.",
      result.valid ? undefined : result.errors
    );
  } catch (error) {
    check(checks, "state", "state.candidates_read", "warn", `Unable to read candidates: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const rfcDir = resolveFromCwd(cwd, config.rfcs ?? ".devns/rfcs");
  if (await exists(rfcDir)) {
    const files = (await readdir(rfcDir)).filter((file) => file.endsWith(".json"));
    for (const file of files) {
      const value = await readJsonFile<unknown>(path.join(rfcDir, file));
      const result = validateSchema(value, rfcSchema);
      check(
        checks,
        "state",
        `state.rfc_schema.${file}`,
        result.valid ? "pass" : "fail",
        result.valid ? `${file} RFC schema is valid.` : `${file} RFC schema is invalid.`,
        result.valid ? undefined : result.errors
      );
    }
  }
}

async function validateLanes(cwd: string, config: DevnsConfig, inventory: FeatureInventory, checks: ValidationCheck[]) {
  const lanes = config.reviewLanes ?? [];
  check(
    checks,
    "lane",
    "lane.configured",
    lanes.length ? "pass" : "warn",
    lanes.length ? `${lanes.length} review lane(s) configured.` : "No review lanes are configured.",
    undefined,
    "Configure at least build/validate lanes for automated completion gates."
  );

  const ids = new Set<string>();
  for (const lane of lanes) {
    const duplicate = ids.has(lane.id);
    ids.add(lane.id);
    check(checks, "lane", `lane.unique.${lane.id}`, duplicate ? "fail" : "pass", duplicate ? `Duplicate lane id ${lane.id}.` : `Lane ${lane.id} id is unique.`);
    if (lane.type === "command") {
      check(
        checks,
        "lane",
        `lane.command.${lane.id}`,
        lane.command ? "pass" : "fail",
        lane.command ? `Command lane ${lane.id} has command.` : `Command lane ${lane.id} is missing command.`
      );
    }
    if (lane.type === "agent") {
      check(
        checks,
        "lane",
        `lane.agent.${lane.id}`,
        lane.agent ? "pass" : "fail",
        lane.agent ? `Agent lane ${lane.id} declares agent ${lane.agent}.` : `Agent lane ${lane.id} is missing agent id.`
      );
    }
  }

  const required = requiredLanes(config);
  for (const feature of inventory.features.filter((item) => item.status === "done" || item.status === "in_progress")) {
    for (const lane of required) {
      const evidence = laneEvidenceFor(feature, lane.id);
      const badDecision = evidence.find((item) => {
        const decision = laneEvidenceDecision(item.summary);
        return decision === "block" || decision === "needs_human_review";
      });
      check(
        checks,
        "lane",
        `lane.evidence.${feature.id}.${lane.id}`,
        !evidence.length ? "warn" : badDecision ? "fail" : "pass",
        !evidence.length
          ? `${feature.id} lacks required lane evidence for ${lane.id}.`
          : badDecision
            ? `${feature.id} has blocking lane evidence for ${lane.id}.`
            : `${feature.id} has required lane evidence for ${lane.id}.`,
        badDecision ? [badDecision.summary] : undefined
      );
    }
  }

  const laneResultExample = {
    lane: "example",
    type: "command",
    status: "pass",
    decision: "allow",
    summary: "Example lane result.",
    confidence: "high",
    findings: [],
    evidence: [],
    artifacts: [],
    recommendedActions: [],
    blocksCompletion: false,
    required: true
  };
  const schema = validateSchema(laneResultExample, laneResultSchema);
  check(
    checks,
    "lane",
    "lane.result_schema",
    schema.valid ? "pass" : "fail",
    schema.valid ? "Lane result schema accepts the canonical result shape." : "Lane result schema rejected canonical result shape.",
    schema.valid ? undefined : schema.errors
  );
}

async function validateHooks(cwd: string, config: DevnsConfig, checks: ValidationCheck[]) {
  const packageJson = await readPackageJson(cwd);
  const hasStopScript = Boolean(packageScript(packageJson, "devns:stop") || packageScript(packageJson, "harness:stop"));
  const hasDevnsPackage =
    Boolean(packageJson.dependencies?.devns || packageJson.devDependencies?.devns) ||
    (await exists(path.join(cwd, "node_modules/.bin/devns")));
  check(
    checks,
    "hook",
    "hook.stop_script",
    hasStopScript || hasDevnsPackage ? "pass" : "warn",
    hasStopScript
      ? "Stop hook script alias is present."
      : hasDevnsPackage
        ? "DEVNS package entrypoint is present for hook adapters."
        : "No DEVNS stop entrypoint was found.",
    undefined,
    "Install DEVNS so hook adapters can call `npx @kpcure/devns stop`, or expose a project-local stop script."
  );

  const codexHook = path.join(cwd, ".codex/hooks.json");
  const claudeSettings = path.join(cwd, ".claude/settings.json");
  const hasHostHook = (await exists(codexHook)) || (await exists(claudeSettings));
  check(
    checks,
    "hook",
    "hook.host_adapter",
    hasHostHook ? "pass" : "warn",
    hasHostHook ? "A host hook adapter file is present." : "No local Codex or Claude hook adapter file was found.",
    undefined,
    "Install a host adapter when this project should auto-continue through lifecycle hooks."
  );

  const recursion = await evaluateClaudeStopHook({ cwd, stop_hook_active: true });
  check(
    checks,
    "hook",
    "hook.recursion_guard",
    recursion.decision === "allow" ? "pass" : "fail",
    recursion.decision === "allow" ? "Stop hook recursion guard allows stop." : "Stop hook recursion guard did not allow stop.",
    [recursion.reason]
  );

  const longTaskLanes = (config.reviewLanes ?? []).filter((lane) => lane.type === "agent" || /playwright|browser|test|build|lint|install/i.test(lane.command ?? ""));
  check(
    checks,
    "hook",
    "hook.long_tasks_boundary",
    "pass",
    "Long-running work is modeled as lanes/evidence, not as Stop hook work.",
    longTaskLanes.map((lane) => `${lane.id}: ${lane.type === "command" ? lane.command : lane.type}`)
  );
}

async function validateKnowledge(cwd: string, config: DevnsConfig, inventory: FeatureInventory, checks: ValidationCheck[]) {
  const promptFiles = [
    "docs/prompt-contracts.md",
    "plugins/codex/devns/prompts/code-review-lane.md",
    "plugins/codex/devns/prompts/rfc-clarification.md",
    "plugins/codex/devns/prompts/domain-knowledge-curator.md",
    "plugins/codex/devns/prompts/stop-hook-continuation.md"
  ];
  for (const file of promptFiles) {
    const present = (await exists(path.join(packageRoot, file))) || (await exists(path.join(cwd, file)));
    check(checks, "review", `review.prompt.${file.replace(/[^a-zA-Z0-9]+/g, "_")}`, present ? "pass" : "warn", present ? `${file} exists.` : `${file} is missing.`);
  }

  for (const feature of inventory.features.filter((item) => item.status === "done")) {
    const filePath = feature.history?.historyPath ? resolveFromCwd(cwd, feature.history.historyPath) : historyPathForFeature(cwd, config, feature.id);
    const records = await readExecutionHistoryRecords(filePath);
    const latest = records.at(-1);
    const hasCurated =
      latest &&
      Array.isArray(latest.decisions) &&
      Array.isArray(latest.pitfalls) &&
      Array.isArray(latest.errors) &&
      Array.isArray(latest.fixes) &&
      Array.isArray(latest.lessons);
    check(
      checks,
      "knowledge",
      `knowledge.history.${feature.id}`,
      hasCurated ? "pass" : "warn",
      hasCurated ? `${feature.id} history has curated knowledge fields.` : `${feature.id} lacks curated history fields.`,
      undefined,
      "Run lanes with --write and record decisions, pitfalls, errors, fixes, and lessons."
    );
  }

  const latestReview = await readLatestMorningReview(cwd, config);
  check(
    checks,
    "review",
    "review.latest_report",
    latestReview ? "pass" : "warn",
    latestReview ? `Latest morning review report ${latestReview.date} is readable.` : "No latest morning review report found.",
    latestReview ? [`${latestReview.packets.length} packet(s)`] : undefined,
    "Run `npx @kpcure/devns review generate`."
  );
}

function summarize(checks: ValidationCheck[], strict: boolean) {
  const summary = {
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length
  };
  const status: ValidationStatus = summary.fail > 0 || (strict && summary.warn > 0) ? "fail" : summary.warn > 0 ? "warn" : "pass";
  return { summary, status };
}

export async function runHarnessValidation(cwd = process.cwd(), options: HarnessValidationOptions = {}): Promise<HarnessValidationReport> {
  const strict = options.strict ?? false;
  const checks: ValidationCheck[] = [];
  const fixed: string[] = [];
  const hasConfig = (await exists(path.join(cwd, ".devns/devns.config.json"))) || (await exists(path.join(cwd, "devns.config.json")));
  const hasFeatures = await exists(path.join(cwd, ".devns/features.json"));

  if (!hasConfig || !hasFeatures) {
    check(
      checks,
      "workspace",
      "workspace.bootstrap",
      "fail",
      "DEVNS workspace is not initialized.",
      [
        hasConfig ? "Config exists." : "Missing .devns/devns.config.json.",
        hasFeatures ? "Feature inventory exists." : "Missing .devns/features.json."
      ],
      "Run `npx @kpcure/devns init --project-name <name> --project-description <goal>`."
    );
    const result = summarize(checks, strict);
    return {
      status: result.status,
      strict,
      fixed,
      summary: result.summary,
      checks
    };
  }

  const config = await readConfig(cwd);
  const inventory = await readInventory(cwd, config);

  await validateWorkspace(cwd, config, options, fixed, checks);
  await validateState(cwd, config, inventory, checks, strict);
  await validateLanes(cwd, config, inventory, checks);
  await validateHooks(cwd, config, checks);
  await validateKnowledge(cwd, config, inventory, checks);

  const result = summarize(checks, strict);
  return {
    status: result.status,
    strict,
    fixed,
    summary: result.summary,
    checks
  };
}
