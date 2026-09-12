import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { dataDir } from "./limits.js";
import type { Playground } from "./types.js";

export function workspaceDir(runId: string): string {
  return resolve(dataDir(), "workspaces", runId);
}

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}

function git(dir?: string): SimpleGit {
  const basic = Buffer.from(`x-access-token:${token()}`).toString("base64");
  return simpleGit(dir, {
    config: [`http.extraHeader=Authorization: Basic ${basic}`],
  }).env({
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Minute",
    GIT_AUTHOR_EMAIL: "minute[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "Minute",
    GIT_COMMITTER_EMAIL: "minute[bot]@users.noreply.github.com",
  });
}

function repoUrl(playground: Playground): string {
  const { owner, repo } = playground.github;
  return `https://github.com/${owner}/${repo}.git`;
}

async function configureIdentity(dir: string) {
  const repo = git(dir);
  await repo.addConfig("user.name", "Minute");
  await repo.addConfig("user.email", "minute[bot]@users.noreply.github.com");
}

export async function ensureAskWorkspace(opts: {
  runId: string;
  owner: string;
  repo: string;
  ref?: string;
  pr?: number;
}): Promise<string> {
  const dir = workspaceDir(opts.runId);
  if (existsSync(join(dir, ".git"))) return dir;

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const url = `https://github.com/${opts.owner}/${opts.repo}.git`;
  const branch = opts.ref && !opts.pr ? opts.ref : undefined;
  let last: unknown;
  const cloneArgs = ["--depth", "1", "--single-branch"];
  if (branch) cloneArgs.unshift("--branch", branch);

  for (let i = 0; i < 4; i++) {
    try {
      await git().clone(url, dir, cloneArgs);
      last = undefined;
      break;
    } catch (err) {
      last = err;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      if (branch && i === 1) {
        cloneArgs.splice(0, cloneArgs.length, "--depth", "1", "--single-branch");
      }
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  if (last) throw last;

  const local = git(dir);
  if (opts.pr) {
    await local.fetch(["origin", `pull/${opts.pr}/head:pr-${opts.pr}`, "--depth", "1"]);
    await local.checkout(`pr-${opts.pr}`);
  } else if (opts.ref && !branch) {
    await local.fetch(["origin", opts.ref, "--depth", "1"]);
    await local.checkout(opts.ref);
  }
  return dir;
}

export async function ensureWorkspace(opts: {
  runId: string;
  playground: Playground;
  branch: string;
  createBranch: boolean;
}): Promise<string> {
  const dir = workspaceDir(opts.runId);
  if (existsSync(join(dir, ".git"))) {
    const repo = git(dir);
    try {
      await repo.revparse(["--abbrev-ref", "HEAD"]);
      return dir;
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      await git().clone(repoUrl(opts.playground), dir, [
        "--branch",
        opts.playground.github.defaultBranch,
        "--single-branch",
        "--depth",
        "1",
      ]);
      last = undefined;
      break;
    } catch (err) {
      last = err;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  if (last) throw last;
  await configureIdentity(dir);
  const repo = git(dir);

  if (opts.createBranch) {
    await repo.checkoutLocalBranch(opts.branch);
    return dir;
  }

  await repo.fetch(["origin", opts.branch, "--depth", "1"]);
  await repo.checkout(["-B", opts.branch, `origin/${opts.branch}`]);
  return dir;
}

export async function commitAll(dir: string, message: string, opts?: { allowEmpty?: boolean }) {
  const repo = git(dir);
  await repo.add(["-A", "."]);
  const status = await repo.status();
  if (status.files.length === 0) {
    if (!opts?.allowEmpty) {
      throw new Error("No files changed — the agent didn't edit anything.");
    }
    await repo.commit(message, undefined, { "--allow-empty": null });
    return;
  }
  await repo.commit(message);
}

export async function pushBranch(dir: string, branch: string) {
  await git(dir).push("origin", branch, ["--set-upstream"]);
}

/** Force-with-lease only on Minute feature branches — never main/master. */
export async function pushMinuteBranch(dir: string, branch: string, force = false) {
  if (force) {
    if (/^(main|master)$/i.test(branch)) {
      throw new Error("refusing force-push of the default branch");
    }
    await git(dir).push("origin", branch, ["--force-with-lease"]);
    return;
  }
  await git(dir).push("origin", branch, ["--set-upstream"]);
}

export async function worktreeDirty(dir: string, ignorePrefix = ".minute"): Promise<boolean> {
  const status = await git(dir).status();
  return status.files.some((f) => !f.path.startsWith(ignorePrefix));
}

export async function revertLastMinuteCommit(dir: string): Promise<boolean> {
  const repo = git(dir);
  const log = await repo.log({ maxCount: 8 });
  const last = log.latest;
  if (!last || !/^minute:/i.test(last.message)) return false;
  try {
    await repo.reset(["--hard", "HEAD~1"]);
    return true;
  } catch {
    return false;
  }
}

export async function pruneWorkspace(runId: string) {
  const dir = workspaceDir(runId);
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

export async function diffFromDefault(dir: string, defaultBranch: string): Promise<string> {
  const repo = git(dir);
  try {
    return await repo.diff([`${defaultBranch}...HEAD`]);
  } catch {
    try {
      return await repo.diff(["HEAD~1"]);
    } catch {
      return await repo.diff(["HEAD"]);
    }
  }
}
