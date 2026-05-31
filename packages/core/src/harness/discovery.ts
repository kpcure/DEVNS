import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateFeature, CandidateInventory, DevnsConfig } from "./types";
import { readCandidates, resolveFromCwd, writeJsonFile } from "./state";

type SourceFile = {
  path: string;
  content: string;
};

type DiscoveryResult = {
  candidates: CandidateFeature[];
  notes: string[];
};

async function readIfExists(cwd: string, relativePath: string): Promise<SourceFile | undefined> {
  const filePath = path.join(cwd, relativePath);
  try {
    await access(filePath);
    return {
      path: relativePath,
      content: await readFile(filePath, "utf8")
    };
  } catch {
    return undefined;
  }
}

function hasMeaningfulProjectGoal(project?: SourceFile) {
  if (!project) {
    return false;
  }
  return !project.content.includes("Fill in the migration or feature goal before running `devns-init`");
}

function nextCandidateId(existing: CandidateFeature[], offset: number) {
  const used = new Set(existing.map((candidate) => candidate.id));
  let index = existing.length + offset + 1;
  while (used.has(`CAND-${String(index).padStart(3, "0")}`)) {
    index += 1;
  }
  return `CAND-${String(index).padStart(3, "0")}`;
}

function packageScripts(source?: SourceFile) {
  if (!source) {
    return [];
  }

  try {
    const parsed = JSON.parse(source.content) as { scripts?: Record<string, string> };
    return Object.keys(parsed.scripts ?? {}).sort();
  } catch {
    return [];
  }
}

export async function discoverCandidateFeatures(cwd: string, existing: CandidateFeature[] = []): Promise<DiscoveryResult> {
  const [project, readme, agents, packageJson] = await Promise.all([
    readIfExists(cwd, ".devns/project.md"),
    readIfExists(cwd, "README.md"),
    readIfExists(cwd, "AGENTS.md"),
    readIfExists(cwd, "package.json")
  ]);

  const candidates: CandidateFeature[] = [];
  const notes: string[] = [];
  let offset = 0;

  if (hasMeaningfulProjectGoal(project)) {
    candidates.push({
      id: nextCandidateId([...existing, ...candidates], offset++),
      title: "Clarify and implement the stated project goal",
      description: "Project background exists in .devns/project.md. Turn the stated goal into concrete RFC-backed implementation features.",
      status: "needs_rfc",
      sources: [project!.path],
      confidence: "medium",
      suggestedPriority: "P0",
      suggestedRisk: "medium",
      suggestedMilestone: "Discovery",
      unknowns: [
        {
          question: "Which parts of the project goal should become the first executable feature slice?",
          severity: "blocking",
          owner: "human"
        }
      ]
    });
  } else {
    candidates.push({
      id: nextCandidateId([...existing, ...candidates], offset++),
      title: "Clarify project background before implementation",
      description: "The DEVNS project background is missing or still uses the default placeholder. Capture the goal before generating executable features.",
      status: "needs_rfc",
      sources: project ? [project.path] : [],
      confidence: "low",
      suggestedPriority: "P0",
      suggestedRisk: "high",
      suggestedMilestone: "Bootstrap",
      unknowns: [
        {
          question: "What is the product, migration, or feature goal DEVNS should plan around?",
          severity: "blocking",
          owner: "human"
        }
      ]
    });
    notes.push("Project background is missing or placeholder-like; discovery stayed conservative.");
  }

  if (readme) {
    candidates.push({
      id: nextCandidateId([...existing, ...candidates], offset++),
      title: "Review README-described product surface for candidate features",
      description: "README.md describes the public product surface. Use it to identify feature candidates before implementation.",
      status: "discovered",
      sources: [readme.path],
      confidence: "medium",
      suggestedPriority: "P1",
      suggestedRisk: "medium",
      suggestedMilestone: "Discovery"
    });
  }

  if (agents) {
    candidates.push({
      id: nextCandidateId([...existing, ...candidates], offset++),
      title: "Align agent workflow with repository operating rules",
      description: "AGENTS.md contains agent-facing rules that should be reflected in DEVNS candidates, RFC gates, and implementation workflow.",
      status: "discovered",
      sources: [agents.path],
      confidence: "high",
      suggestedPriority: "P1",
      suggestedRisk: "medium",
      suggestedMilestone: "Discovery"
    });
  }

  const scripts = packageScripts(packageJson);
  if (scripts.length) {
    candidates.push({
      id: nextCandidateId([...existing, ...candidates], offset++),
      title: "Derive verification candidates from package scripts",
      description: `package.json exposes scripts (${scripts.slice(0, 8).join(", ")}). Review which should become DEVNS validation lanes or feature verification steps.`,
      status: "discovered",
      sources: [packageJson!.path],
      confidence: "high",
      suggestedPriority: "P1",
      suggestedRisk: "low",
      suggestedMilestone: "Discovery"
    });
  }

  if (!readme && !agents && !scripts.length) {
    notes.push("Few repository signals were found; ask the human for background before creating implementation features.");
  }

  return { candidates, notes };
}

export async function writeDiscoveredCandidates(cwd: string, config: DevnsConfig, options: { force?: boolean } = {}) {
  const inventory = await readCandidates(cwd, config);
  const existing = inventory.candidates ?? [];
  const discovery = await discoverCandidateFeatures(cwd, options.force ? [] : existing);
  const existingBySignature = new Set(existing.map((candidate) => `${candidate.title}\n${candidate.description}`));
  const newCandidates = discovery.candidates.filter(
    (candidate) => options.force || !existingBySignature.has(`${candidate.title}\n${candidate.description}`)
  );
  const nextInventory: CandidateInventory = {
    ...inventory,
    candidates: options.force ? newCandidates : [...existing, ...newCandidates],
    notes: [...(inventory.notes ?? []), ...discovery.notes]
  };

  if (config.candidates) {
    await writeJsonFile(resolveFromCwd(cwd, config.candidates), nextInventory);
  }

  return {
    candidates: newCandidates,
    inventory: nextInventory,
    notes: discovery.notes
  };
}
