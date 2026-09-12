import "dotenv/config";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "../src/config.js";
import { githubWriteOk } from "../src/github.js";
import { ensureWorkspace, commitAll, pushBranch } from "../src/git.js";
import { ollamaBase, ollamaModel } from "../src/llm.js";

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL ${name}: ${msg.replace(/https:\/\/[^/\s]*:[^/\s]*@/g, "https://***@").slice(0, 400)}`);
    process.exitCode = 1;
  }
}

async function main() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  await check("ollama", async () => {
    const res = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const model = ollamaModel();
    if (!data.models?.some((m) => m.name === model || m.name.startsWith(`${model}:`))) {
      throw new Error(`model ${model} not pulled`);
    }
  });

  await check("playwright", async () => {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  });

  await check("github write (api)", async () => {
    if (!(await githubWriteOk())) throw new Error("token cannot push to the playground repo");
  });

  await check("git clone + push + delete branch", async () => {
    const cfg = loadConfig();
    const playground = cfg.playgrounds[0];
    if (!playground) throw new Error("no playground");
    const runId = `minute-probe-${Date.now()}`;
    const dir = await ensureWorkspace({
      runId,
      playground,
      branch: runId,
      createBranch: true,
    });
    await commitAll(dir, "minute probe (delete me)", { allowEmpty: true });
    await pushBranch(dir, runId);
    const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
    await gh.git.deleteRef({
      owner: playground.github.owner,
      repo: playground.github.repo,
      ref: `heads/${runId}`,
    });
    rmSync(join(process.env.MINUTE_DATA_DIR ?? ".data", "workspaces", runId), { recursive: true, force: true });
  });

  if (process.exitCode) {
    console.error("not ready");
    process.exit(1);
  }
  console.log("ready");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
