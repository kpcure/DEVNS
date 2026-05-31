import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sectionStart = "<!-- devns:start -->";
const sectionEnd = "<!-- devns:end -->";

export type AgentsIndexOptions = {
  featuresPath: string;
  configPath: string;
  dashboardPath: string;
};

export function renderDevnsAgentsSection(options: AgentsIndexOptions) {
  return [
    sectionStart,
    "## DEVNS Context Index",
    "",
    "DEVNS is a local-first agent harness. Use this section as the entrypoint, not as a full methodology dump.",
    "",
    "### First Action",
    "",
    "Run `npx @kpcure/devns doctor --json` when available. In the DEVNS source checkout, `npm run devns -- doctor --json` is equivalent. If that single entrypoint is missing, inspect `package.json` and use the closest DEVNS status command, usually `npm run devns:doctor -- --json`, `npm run devns:status -- --json`, or `npm run devns:queue -- status --json`.",
    "",
    "### Sources Of Truth",
    "",
    `- Config: \`${options.configPath}\``,
    `- Feature inventory: \`${options.featuresPath}\``,
    "- Candidate inventory: `.devns/candidates.json`",
    "- RFC records: `.devns/rfcs/`",
    "- Execution history: `.devns/history/`",
    "- Project background: `.devns/project.md`",
    "- Project-local skill overrides: `.devns/skills/`",
    "- Project-local agent overrides: `.devns/agents/`",
    "- Project-local policies: `.devns/policies/`",
    "- Project-local lane overrides: `.devns/lanes/`",
    `- Human dashboard: \`${options.dashboardPath}\``,
    "",
    "### Detail Routes",
    "",
    "- First-run and command usage: `docs/getting-started.md`, `docs/command-surface.md`",
    "- Feature/RFC schema: `docs/feature-schema.md`, `tools/schema/`",
    "- Hook behavior: `hooks/stop-hook.md`, `docs/claude-code-hooks.md`, `docs/codex-plugin.md`",
    "- Review-agent contract: `docs/review-agent-contract.md`, `tools/schema/lane-result.schema.json`",
    "- Prompt contracts: `docs/prompt-contracts.md`, `plugins/*/devns/prompts/`",
    "- Roadmap and project status: `README.md`, `README.zh-CN.md`, `docs/`",
    "",
    "### Mode Selection",
    "",
    "- Bootstrap: if `.devns/devns.config.json` or `.devns/features.json` is missing, run `devns-init` before implementation.",
    "- Claim: if no feature is active, inspect the queue and claim only a feature with an approved RFC.",
    "- Continue: if a feature is `in_progress`, read its RFC, context, evidence, and latest history before editing.",
    "- Blocked: if requirements, RFC approval, or verification evidence is missing, record the blocker instead of guessing.",
    "- Review: after implementation, run configured lanes, update evidence/history, then commit exactly one feature.",
    "",
    "### Operating Rules",
    "",
    "- Do not implement from a one-line feature description; require an approved RFC.",
    "- Keep generated evidence concise in `features.json`; put detailed execution records in `.devns/history/`.",
    "- Read curated history for decisions, rejected alternatives, pitfalls, errors, fixes, and lessons before touching related files.",
    "- After RFC clarification, prefer an isolated worker/subagent or fresh implementation context for one feature when the host supports it; keep the main context for orchestration and evidence aggregation.",
    "- Before completion, run configured lanes with `npx @kpcure/devns lanes run --write --json`.",
    "- Preserve project-local overrides under `.devns/`.",
    "- One feature per commit.",
    "- If a documented command is unavailable in a target project, inspect local scripts before failing the workflow.",
    "",
    "### Hook And Review-Agent Boundary",
    "",
    "- Stop hooks are host lifecycle callbacks. Do not manually invoke them as the normal way to continue work; end the turn naturally and let the host trigger the hook.",
    "- Do not model DEVNS as two same-event Stop hooks where the first hook writes review output and the second hook immediately reads it. Matching hooks may run independently or in parallel in host runtimes.",
    "- DEVNS uses one host-neutral stop command as the orchestrator: it inspects persisted JSON evidence/history, decides whether to block or allow stopping, and may claim the next approved feature.",
    "- Review agents are optional read-only evidence producers behind lanes. DEVNS defines the lane-result contract; it does not provide an LLM provider or require a specific subagent runtime.",
    "- Long tests, browser checks, static analysis, and LLM review should run before the final stop attempt and write evidence/history for the stop hook to inspect.",
    "- A review lane should receive the Git diff, RFC requirements, static/dynamic lane output, and relevant history, then return structured findings rather than free-form advice.",
    sectionEnd
  ]
    .filter(Boolean)
    .join("\n");
}

export function upsertDevnsAgentsSection(current: string, section: string) {
  const startIndex = current.indexOf(sectionStart);
  const endIndex = current.indexOf(sectionEnd);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return `${current.slice(0, startIndex).trimEnd()}\n\n${section}\n\n${current.slice(endIndex + sectionEnd.length).trimStart()}`;
  }

  return `${current.trimEnd()}\n\n${section}\n`;
}

export async function writeAgentsIndex(cwd: string, options: AgentsIndexOptions) {
  const filePath = path.join(cwd, "AGENTS.md");
  const section = renderDevnsAgentsSection(options);
  let current = "# AGENTS.md\n";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    // Missing AGENTS.md is fine; init will create one with the DEVNS section.
  }
  const next = upsertDevnsAgentsSection(current, section);
  await writeFile(filePath, next);
}
