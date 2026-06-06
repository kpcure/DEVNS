#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runDevns(repoRoot: string, cwd: string, ...args: string[]) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      path.join(repoRoot, "node_modules/tsx/dist/esm/index.mjs"),
      path.join(repoRoot, "packages/core/src/cli/devns.ts"),
      ...args
    ], { cwd });
    return stdout;
  } catch (error) {
    const execError = error as Error & { stdout?: string };
    if (execError.stdout) return execError.stdout;
    throw error;
  }
}

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-install-dogfood-"));
  const claudeCwd = await mkdtemp(path.join(os.tmpdir(), "devns-install-claude-"));
  const repoRoot = process.cwd();

  try {
    await writeFile(
      path.join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "devns-install-dogfood",
          version: "0.0.0",
          scripts: {
            test: "echo \"Error: no test specified\" && exit 1"
          },
          devDependencies: {
            devns: "file:../never-stop"
          }
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      path.join(claudeCwd, "package.json"),
      `${JSON.stringify(
        {
          name: "devns-install-claude",
          version: "0.0.0",
          scripts: {
            build: "echo build"
          },
          devDependencies: {
            devns: "file:../never-stop"
          }
        },
        null,
        2
      )}\n`
    );

    const bootstrap = JSON.parse(await runDevns(repoRoot, cwd, "doctor", "--json"));
    assert.equal(bootstrap.mode, "bootstrap_required");

    await runDevns(
      repoRoot,
      cwd,
      "init",
      "--project-name",
      "Install Dogfood",
      "--project-description",
      "Dogfood install entrypoint.",
      "--host",
      "codex"
    );

    const config = JSON.parse(await readFile(path.join(cwd, ".devns", "devns.config.json"), "utf8"));
    assert.equal(config.reviewLanes.some((lane: { id: string }) => lane.id === "test"), false);
    const codexHooks = JSON.parse(await readFile(path.join(cwd, ".codex", "hooks.json"), "utf8"));
    assert.match(codexHooks.hooks.Stop[0].hooks[0].command, /DEVNS_PROJECT_DIR=/);
    assert.match(codexHooks.hooks.Stop[0].hooks[0].command, new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(codexHooks.hooks.Stop[0].hooks[0].command, /plugins\/codex\/devns\/scripts\/devns-stop-hook\.sh/);
    const stopHook = await stat(path.join(cwd, "plugins", "codex", "devns", "scripts", "devns-stop-hook.sh"));
    assert.equal(Boolean(stopHook.mode & 0o111), true);
    const reviewAdapter = await stat(path.join(cwd, ".devns", "adapters", "code-review.codex.sh"));
    assert.equal(Boolean(reviewAdapter.mode & 0o111), true);
    const reviewLane = JSON.parse(await readFile(path.join(cwd, ".devns", "lanes", "code-review.json"), "utf8"));
    assert.equal(reviewLane.type, "agent");
    assert.equal(reviewLane.command, "bash .devns/adapters/code-review.codex.sh");
    const codexWorker = await readFile(path.join(cwd, ".codex", "agents", "devns_feature_worker.toml"), "utf8");
    assert.match(codexWorker, /name = "devns_feature_worker"/);
    const codexReviewer = await readFile(path.join(cwd, ".codex", "agents", "devns_code_reviewer.toml"), "utf8");
    assert.match(codexReviewer, /lane-result JSON/);

    const emptyRfc = JSON.parse(await runDevns(repoRoot, cwd, "rfc", "check", "--all", "--json"));
    assert.deepEqual(emptyRfc, { results: [], ready: true });

    const lanes = JSON.parse(await runDevns(repoRoot, cwd, "lanes", "run", "--json"));
    assert.equal(lanes.blocksCompletion, false);
    assert.ok(lanes.results.some((result: { lane: string }) => result.lane === "security_basic"));
    assert.ok(
      lanes.results.some(
        (result: { lane: string; type: string; status: string; summary: string }) =>
          result.lane === "code-review" &&
          result.type === "agent" &&
          result.status === "skipped" &&
          /no active or selected feature/.test(result.summary)
      )
    );

    const validation = JSON.parse(await runDevns(repoRoot, cwd, "validate", "--json"));
    assert.equal(validation.summary.fail, 0);
    assert.ok(
      validation.checks.some(
        (check: { id: string; status: string; summary: string }) =>
          check.id === "hook.stop_script" &&
          check.status === "pass" &&
          /DEVNS package entrypoint/.test(check.summary)
      )
    );

    await runDevns(
      repoRoot,
      claudeCwd,
      "init",
      "--project-name",
      "Claude Install Dogfood",
      "--project-description",
      "Claude hook install entrypoint.",
      "--host",
      "claude"
    );
    const claudeSettings = JSON.parse(await readFile(path.join(claudeCwd, ".claude", "settings.json"), "utf8"));
    const claudeHook = claudeSettings.hooks.Stop[0].hooks[0];
    assert.equal(claudeHook.type, "agent");
    assert.match(claudeHook.prompt, /DEVNS Stop Review Agent/);
    assert.match(claudeHook.prompt, /DEVNS_STOP_AGENT_HOOK=claude/);
    const claudePrompt = await readFile(path.join(claudeCwd, "plugins", "claude-code", "devns", "prompts", "stop-review-agent-hook.md"), "utf8");
    assert.match(claudePrompt, /Return exactly one JSON object/);
    assert.match(claudePrompt, /lanes ingest/);
    const claudeReviewAdapter = await stat(path.join(claudeCwd, ".devns", "adapters", "code-review.claude.sh"));
    assert.equal(Boolean(claudeReviewAdapter.mode & 0o111), true);
    const claudeReviewLane = JSON.parse(await readFile(path.join(claudeCwd, ".devns", "lanes", "code-review.json"), "utf8"));
    assert.equal(claudeReviewLane.type, "agent");
    assert.equal(claudeReviewLane.command, "bash .devns/adapters/code-review.claude.sh");
    const claudeWorker = await readFile(path.join(claudeCwd, ".claude", "agents", "feature-worker.md"), "utf8");
    assert.match(claudeWorker, /name: devns-feature-worker/);
    const claudeReviewer = await readFile(path.join(claudeCwd, ".claude", "agents", "code-reviewer.md"), "utf8");
    assert.match(claudeReviewer, /name: devns-code-reviewer/);

    process.stdout.write("Install dogfood smoke passed.\n");
  } finally {
    await Promise.all([cwd, claudeCwd].map((project) => rm(project, { recursive: true, force: true })));
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown install dogfood smoke error"}\n`);
  process.exitCode = 1;
});
