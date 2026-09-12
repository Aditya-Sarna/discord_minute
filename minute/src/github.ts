import { Octokit } from "@octokit/rest";
import type { Playground, Proof, Run } from "./types.js";
import { prBodyFromChange, titleFromChange } from "./pr-describe.js";
import { loadConfig } from "./config.js";

function octokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return new Octokit({ auth: token });
}

let writeCache: { at: number; ok: boolean } | null = null;

export async function githubWriteOk(): Promise<boolean> {
  if (!process.env.GITHUB_TOKEN) return false;
  if (writeCache && Date.now() - writeCache.at < 5 * 60_000) return writeCache.ok;
  try {
    const gh = octokit();
    const cfg = loadConfig();
    const pg = cfg.playgrounds[0];
    if (!pg) {
      await gh.users.getAuthenticated();
      writeCache = { at: Date.now(), ok: true };
      return true;
    }
    const repo = await gh.repos.get({ owner: pg.github.owner, repo: pg.github.repo });
    const ok = Boolean(repo.data.permissions?.push);
    writeCache = { at: Date.now(), ok };
    return ok;
  } catch {
    writeCache = { at: Date.now(), ok: false };
    return false;
  }
}

function octokitStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const n = Number((err as { status?: number }).status);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export async function inspectGithubRepo(
  owner: string,
  repo: string,
): Promise<{ owner: string; repo: string; defaultBranch: string; description: string }> {
  const gh = octokit();
  try {
    const r = await gh.repos.get({ owner, repo });
    return {
      owner: r.data.owner.login,
      repo: r.data.name,
      defaultBranch: r.data.default_branch || "main",
      description: r.data.description || "",
    };
  } catch (err) {
    const status = octokitStatus(err);
    if (status === 404) throw new Error("GitHub repo not found.");
    throw err;
  }
}

export async function createScratchRepo(opts: {
  owner: string;
  name: string;
  description: string;
}): Promise<{ owner: string; repo: string; defaultBranch: string; url: string }> {
  const gh = octokit();
  const me = await gh.users.getAuthenticated();
  const privateRepo = process.env.MINUTE_SCRATCH_PUBLIC !== "1";
  const description = opts.description.replace(/\s+/g, " ").trim().slice(0, 140) || "Started from Discord with Minute";

  const create = async (name: string) => {
    if (opts.owner.toLowerCase() === me.data.login.toLowerCase()) {
      return gh.repos.createForAuthenticatedUser({
        name,
        private: privateRepo,
        auto_init: true,
        description,
      });
    }
    return gh.repos.createInOrg({
      org: opts.owner,
      name,
      private: privateRepo,
      auto_init: true,
      description,
    });
  };

  let last: unknown;
  for (let i = 0; i < 6; i++) {
    const name = i === 0 ? opts.name : `${opts.name}-${i + 1}`.slice(0, 100);
    try {
      const repo = await create(name);
      return {
        owner: repo.data.owner.login,
        repo: repo.data.name,
        defaultBranch: repo.data.default_branch || "main",
        url: repo.data.html_url,
      };
    } catch (err) {
      last = err;
      if (octokitStatus(err) === 422) continue;
      throw err;
    }
  }
  throw last instanceof Error ? last : new Error("Could not create a GitHub repo with that name.");
}

export async function openPr(opts: {
  playground: Playground;
  run: Run;
  title: string;
  body: string;
}): Promise<{ number: number; url: string }> {
  const gh = octokit();
  const { owner, repo, defaultBranch } = opts.playground.github;
  const pr = await gh.pulls.create({
    owner,
    repo,
    title: opts.title,
    head: opts.run.branch,
    base: defaultBranch,
    body: opts.body,
  });
  return { number: pr.data.number, url: pr.data.html_url };
}

export async function updatePr(
  playground: Playground,
  prNumber: number,
  opts: { title?: string; body: string },
) {
  const gh = octokit();
  await gh.pulls.update({
    owner: playground.github.owner,
    repo: playground.github.repo,
    pull_number: prNumber,
    title: opts.title,
    body: opts.body,
  });
}

export async function updatePrBody(playground: Playground, prNumber: number, body: string) {
  await updatePr(playground, prNumber, { body });
}

export function prBody(opts: {
  playground: Playground;
  run: Run;
  summary: string;
  proof: Proof;
  signedOff: boolean;
  diff?: string;
}): string {
  return prBodyFromChange({
    playground: opts.playground,
    run: opts.run,
    summary: opts.summary,
    diff: opts.diff || opts.run.lastDiff || "",
    proof: opts.proof,
    signedOff: opts.signedOff,
    threadUrl: opts.run.threadUrl,
  });
}

export { titleFromChange };

export async function commentProof(
  playground: Playground,
  prNumber: number,
  _proof: Proof,
  caption: string,
) {
  const gh = octokit();
  const { owner, repo } = playground.github;
  await gh.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: caption,
  });
}

export async function getPr(playground: Playground, prNumber: number) {
  const gh = octokit();
  return gh.pulls.get({
    owner: playground.github.owner,
    repo: playground.github.repo,
    pull_number: prNumber,
  });
}

export async function listReviews(playground: Playground, prNumber: number) {
  const gh = octokit();
  const { data } = await gh.pulls.listReviews({
    owner: playground.github.owner,
    repo: playground.github.repo,
    pull_number: prNumber,
  });
  return data;
}
