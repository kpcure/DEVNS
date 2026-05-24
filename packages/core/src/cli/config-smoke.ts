#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigError, loadConfig } from "../harness/config";

async function main() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devns-config-"));

  try {
    const defaultOnly = await loadConfig(cwd);
    assert.equal(defaultOnly.config.features, ".devns/features.json");
    assert.equal(defaultOnly.config.completionPolicy?.whenNoActiveFeature, "claim_next");
    assert.equal(defaultOnly.config.completionPolicy?.requireCommit, true);
    assert.deepEqual(defaultOnly.sources.map((source) => source.name), ["built-in"]);

    await mkdir(path.join(cwd, ".devns"), { recursive: true });
    await mkdir(path.join(cwd, ".devns", "skills"), { recursive: true });
    await mkdir(path.join(cwd, ".devns", "agents"), { recursive: true });
    await mkdir(path.join(cwd, ".devns", "policies"), { recursive: true });
    await mkdir(path.join(cwd, ".devns", "lanes"), { recursive: true });
    await mkdir(path.join(cwd, ".devns", "sensors"), { recursive: true });
    await writeFile(path.join(cwd, ".devns", "skills", "run.md"), "# Project run skill\n");
    await writeFile(path.join(cwd, ".devns", "agents", "code-reviewer.json"), "{}\n");
    await writeFile(path.join(cwd, ".devns", "policies", "stop-hook.json"), "{}\n");
    await writeFile(path.join(cwd, ".devns", "lanes", "scope-guard.json"), "{}\n");
    await writeFile(path.join(cwd, ".devns", "sensors", "api-contract.sh"), "#!/usr/bin/env sh\n");
    await writeFile(
      path.join(cwd, ".devns", "devns.config.json"),
      JSON.stringify(
        {
          version: 1,
          features: "custom/features.json",
          hooks: {
            stop: {
              retryBudget: 9
            }
          },
          reviewLanes: [
            {
              id: "project-build",
              type: "command",
              command: "npm run build",
              required: true,
              blocksCompletion: true
            }
          ]
        },
        null,
        2
      )
    );

    const resolved = await loadConfig(cwd, {
      pluginDefaults: {
        candidates: "plugin/candidates.json",
        hooks: {
          stop: {
            blockOn: {
              pluginGate: true
            }
          }
        },
        skills: {
          run: "plugin-run"
        }
      },
      overrides: {
        features: "override/features.json"
      }
    });

    assert.deepEqual(resolved.sources.map((source) => source.name), ["built-in", "plugin", "project", "extensions", "cli"]);
    assert.equal(resolved.config.features, "override/features.json");
    assert.equal(resolved.config.candidates, "plugin/candidates.json");
    assert.equal(resolved.config.hooks?.stop?.mode, "gate");
    assert.equal(resolved.config.hooks?.stop?.retryBudget, 9);
    assert.equal(resolved.config.hooks?.stop?.blockOn?.pluginGate, true);
    assert.equal(resolved.config.completionPolicy?.whenNoClaimableFeature, "allow_stop");
    assert.equal(resolved.config.completionPolicy?.requireEvidence, true);
    assert.equal(resolved.config.skills?.run, ".devns/skills/run.md");
    assert.equal(resolved.config.extensions?.agents?.["code-reviewer"], ".devns/agents/code-reviewer.json");
    assert.equal(resolved.config.extensions?.policies?.["stop-hook"], ".devns/policies/stop-hook.json");
    assert.equal(resolved.config.extensions?.lanes?.["scope-guard"], ".devns/lanes/scope-guard.json");
    assert.equal(resolved.config.sensors?.["api-contract"], ".devns/sensors/api-contract.sh");
    assert.equal(resolved.config.reviewLanes?.[0]?.id, "project-build");

    await writeFile(
      path.join(cwd, ".devns", "bad.config.json"),
      JSON.stringify(
        {
          version: 1,
          features: ".devns/features.json",
          unknown: true
        },
        null,
        2
      )
    );

    await assert.rejects(
      () => loadConfig(cwd, { configPath: ".devns/bad.config.json" }),
      (error) => error instanceof ConfigError && error.code === "CONFIG_INVALID" && /unknown property unknown/.test(error.message)
    );

    process.stdout.write("Config loader smoke passed.\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown config smoke error"}\n`);
  process.exitCode = 1;
});
