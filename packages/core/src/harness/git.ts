import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitStatusEntry = {
  path: string;
  index: string;
  worktree: string;
  raw: string;
};

async function git(cwd: string, args: string[]) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });
    return result.stdout.trimEnd();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    throw new Error((err.stderr || err.stdout || err.message || `git ${args.join(" ")} failed`).trim());
  }
}

export async function gitStatus(cwd: string): Promise<GitStatusEntry[]> {
  const stdout = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (!stdout.trim()) {
    return [];
  }

  return stdout.split("\n").map((line) => ({
    index: line.slice(0, 1),
    worktree: line.slice(1, 2),
    path: line.slice(3).trim(),
    raw: line
  }));
}

export async function changedFiles(cwd: string) {
  return (await gitStatus(cwd)).map((entry) => entry.path);
}

export async function currentHead(cwd: string) {
  return git(cwd, ["rev-parse", "--short", "HEAD"]);
}

export async function commitFiles(cwd: string, files: string[], message: string) {
  if (!files.length) {
    throw new Error("No files were provided for git commit.");
  }

  await git(cwd, ["add", "--", ...files]);
  await git(cwd, ["commit", "-m", message]);
  return currentHead(cwd);
}
