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
    "- Preserve project-local overrides under `.devns/`.",
    "- One feature per commit.",
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
