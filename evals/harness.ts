import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateCompletionGate } from "../packages/core/src/harness/completion-gate";
import { runScopeGuard } from "../packages/core/src/harness/builtin-lanes";
import type { CandidateFeature, Feature, ReviewDecision } from "../packages/core/src/harness/types";
import { validateSchema } from "../packages/core/src/harness/schema-validator";
import evalCaseSchema from "../tools/schema/eval-case.schema.json";

export type EvalDecision = "allowed" | "blocked";
export type EvalTier = "t1" | "t2" | "t3";

export type EvalCase = {
  id: string;
  tier: EvalTier;
  mode: string;
  generality_level: "distribution" | "task" | "domain" | "general";
  given: Record<string, unknown>;
  action: {
    gate: "completion_independent_review" | "candidate_provenance" | "scope_guard";
    cmd?: string;
    args?: Record<string, unknown>;
  };
  expect: {
    decision: EvalDecision;
    reasonContains?: string;
  };
};

export type EvalCaseOutcome = {
  id: string;
  tier: EvalTier;
  mode: string;
  expected: EvalDecision;
  actual: EvalDecision;
  reason: string;
  pass: boolean;
};

function asDecision(blocked: boolean): EvalDecision {
  return blocked ? "blocked" : "allowed";
}

function containsProjectExternalDomainTerm(candidate: CandidateFeature, projectText: string) {
  const text = `${candidate.id} ${candidate.title} ${candidate.description}`.toLowerCase();
  const project = projectText.toLowerCase();
  const sentinelTerms = ["library", "borrow", "patron", "book checkout", "图书馆", "借阅", "馆藏", "读者"];
  return sentinelTerms.some((term) => text.includes(term.toLowerCase()) && !project.includes(term.toLowerCase()));
}

function evaluateCandidateProvenance(given: Record<string, unknown>) {
  const candidates = (given.candidates ?? []) as CandidateFeature[];
  const projectText = String(given.projectText ?? "");
  const missing = candidates.filter((candidate) => !(candidate.sources?.length ?? 0));
  const drifted = candidates.filter((candidate) => containsProjectExternalDomainTerm(candidate, projectText));

  if (missing.length || drifted.length) {
    return {
      decision: "blocked" as const,
      reason: [
        missing.length ? `${missing.length} candidate(s) missing provenance sources.` : "",
        drifted.length ? `${drifted.length} candidate(s) contain project-external domain terms.` : ""
      ]
        .filter(Boolean)
        .join(" ")
    };
  }

  return { decision: "allowed" as const, reason: "Candidate provenance gate passed." };
}

async function evaluateScopeGuard(given: Record<string, unknown>) {
  const result = await runScopeGuard(
    { id: "scope-guard", type: "builtin", required: true, blocksCompletion: true },
    {
      cwd: process.cwd(),
      feature: given.feature as Feature,
      changedFiles: (given.changedFiles ?? []) as string[]
    }
  );
  return {
    decision: asDecision(result.decision === "block"),
    reason: result.summary
  };
}

export async function runT1Case(testCase: EvalCase): Promise<EvalCaseOutcome> {
  let result: { decision: EvalDecision; reason: string };

  if (testCase.action.gate === "completion_independent_review") {
    const feature = testCase.given.feature as Feature;
    const review = ((testCase.action.args?.review as ReviewDecision | undefined) ?? "approved") as ReviewDecision;
    const gate = evaluateCompletionGate(feature, { review });
    result = { decision: gate.decision, reason: gate.reason };
  } else if (testCase.action.gate === "candidate_provenance") {
    result = evaluateCandidateProvenance(testCase.given);
  } else {
    result = await evaluateScopeGuard(testCase.given);
  }

  const reasonMatches = testCase.expect.reasonContains ? result.reason.includes(testCase.expect.reasonContains) : true;
  return {
    id: testCase.id,
    tier: testCase.tier,
    mode: testCase.mode,
    expected: testCase.expect.decision,
    actual: result.decision,
    reason: result.reason,
    pass: result.decision === testCase.expect.decision && reasonMatches
  };
}

export async function loadEvalCases(rootDir: string) {
  const cases: EvalCase[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const parsed = JSON.parse(await readFile(fullPath, "utf8")) as EvalCase;
        const validation = validateSchema(parsed, evalCaseSchema);
        if (!validation.valid) {
          throw new Error(`Eval case ${fullPath} failed schema validation:\n${validation.errors.join("\n")}`);
        }
        cases.push(parsed);
      }
    }
  }
  await walk(rootDir);
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
