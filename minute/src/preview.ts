import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { dataDir } from "./limits.js";
import { log } from "./logger.js";
import type { Playground } from "./types.js";

type StatusFn = (text: string) => Promise<void>;

function shotPath(runId: string, label: string): string {
  const p = resolve(dataDir(), "proof", runId, `${label}.png`);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

function joinUrl(base: string, route: string): string {
  try {
    return new URL(route || "/", base).toString();
  } catch {
    return `${base.replace(/\/$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
  }
}

const livePreviews = new Set<ChildProcess>();

export function previewListenUrl(template: string, port: number): string {
  try {
    const u = new URL(template);
    u.hostname = "127.0.0.1";
    u.port = String(port);
    return u.toString();
  } catch {
    return `http://127.0.0.1:${port}/`;
  }
}

export function allocatePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!addr || typeof addr === "string") {
          reject(new Error("could not allocate a preview port"));
          return;
        }
        resolvePort(addr.port);
      });
    });
  });
}

export function killAllPreviews() {
  for (const child of livePreviews) killTree(child);
  livePreviews.clear();
}

export function previewDir(workspaceDir: string, playground: Playground): string {
  const configured = playground.preview.cwd?.trim();
  if (configured) return resolve(workspaceDir, configured);
  if (existsSync(join(workspaceDir, "package.json"))) return workspaceDir;
  if (existsSync(join(workspaceDir, "frontend", "package.json"))) {
    return join(workspaceDir, "frontend");
  }
  return workspaceDir;
}

function previewStartEnv(port: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CI;
  if (env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
    delete env.PLAYWRIGHT_BROWSERS_PATH;
  }
  env.NODE_ENV = "development";
  env.PORT = port;
  env.BROWSER = "none";
  env.HOST = "127.0.0.1";
  env.DISABLE_ESLINT_PLUGIN = "true";
  env.ESLINT_NO_DEV_ERRORS = "true";
  env.SKIP_PREFLIGHT_CHECK = "true";
  env.TSC_COMPILE_ON_ERROR = "true";
  env.GENERATE_SOURCEMAP = "false";
  env.FAST_REFRESH = "false";
  env.WDS_SOCKET_HOST = "127.0.0.1";
  env.DANGEROUSLY_DISABLE_HOST_CHECK = "true";
  return env;
}

/** Exported for tests. True when the preview HTTP body is a real page, not a compile splash. */
export function isPreviewReady(status: number, body: string): boolean {
  if (status < 200 || status >= 400) return false;
  if (/compiling\.\.\./i.test(body) || /waiting for compilation/i.test(body)) return false;
  try {
    const json = JSON.parse(body) as {
      status?: string;
      webpack?: { isHealthy?: boolean; hasCompiled?: boolean };
    };
    if (json.webpack?.hasCompiled === true) return true;
    if (json.status === "unhealthy") return false;
    if (json.webpack?.hasCompiled === false) return false;
    if (json.webpack?.isHealthy === false) return false;
  } catch {
    // html
  }
  return status < 500;
}

async function waitForUrl(
  url: string,
  seconds: number,
  onStatus?: StatusFn,
  died?: () => Error | undefined,
) {
  const deadline = Date.now() + seconds * 1000;
  const started = Date.now();
  let lastTick = 0;
  while (Date.now() < deadline) {
    const early = died?.();
    if (early) throw early;
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (onStatus && elapsed >= lastTick + 10) {
      lastTick = elapsed;
      await onStatus(`Starting the app… ${elapsed}s`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const text = await res.text().catch(() => "");
      if (isPreviewReady(res.status, text)) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Preview never came up at ${url}`);
}

async function dismissChrome(page: Page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("I agree")',
    'button:has-text("OK")',
    '[aria-label*="accept" i]',
    '[id*="cookie"] button',
    '[class*="cookie"] button',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 350 })) await btn.click({ timeout: 700 });
    } catch {
      // no banner
    }
  }
}

async function screenshotUrl(
  url: string,
  dest: string,
): Promise<{ path: string; phonePath: string }> {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const settle = Date.now() + 45_000;
    while (Date.now() < settle) {
      const html = await page.content();
      if (isPreviewReady(200, html)) break;
      await page.waitForTimeout(400);
    }
    await dismissChrome(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: dest, fullPage: true });
    const phoneDest = dest.replace(/\.png$/, "-phone.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await dismissChrome(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: phoneDest, fullPage: false });
    return { path: dest, phonePath: phoneDest };
  } finally {
    await browser.close();
  }
}

function lockfileHash(dir: string): string | undefined {
  for (const name of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    const p = join(dir, name);
    if (existsSync(p)) {
      return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
    }
  }
  return undefined;
}

async function runNpmInstall(cwd: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", npm_config_legacy_peer_deps: "true" };
    delete env.CI;
    const child = spawn("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stdout?.on("data", (b) => log.info({ npm: String(b).slice(0, 160).trim() }, "npm install"));
    child.stderr?.on("data", (b) => {
      const s = String(b);
      err = (err + s).slice(-4000);
      log.info({ npmErr: s.slice(0, 160).trim() }, "npm install");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("npm install timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install failed: ${err.replace(/\s+/g, " ").slice(-240)}`));
    });
  });
}

export async function installDeps(dir: string, playground: Playground, onStatus?: StatusFn): Promise<void> {
  if (!playground.preview.install) return;
  const cwd = previewDir(dir, playground);
  if (!existsSync(join(cwd, "package.json"))) return;
  const marker = join(cwd, ".minute-installed");
  if (existsSync(marker) && existsSync(join(cwd, "node_modules"))) return;

  const hash = lockfileHash(cwd);
  const cache = hash ? resolve(dataDir(), "npm-cache", hash, "node_modules") : undefined;
  const destModules = join(cwd, "node_modules");
  if (cache && existsSync(cache) && !existsSync(destModules)) {
    await onStatus?.("Restoring packages for the photo…");
    await mkdir(dirname(cache), { recursive: true });
    await cp(cache, destModules, { recursive: true });
    mkdirSync(marker, { recursive: true });
    return;
  }

  await onStatus?.("Installing packages for the photo…");
  const timeout = (playground.preview.installTimeoutSeconds || 240) * 1000;
  await runNpmInstall(cwd, timeout);
  if (cache && existsSync(destModules)) {
    await mkdir(dirname(cache), { recursive: true });
    await rm(cache, { recursive: true, force: true });
    await cp(destModules, cache, { recursive: true });
  }
  mkdirSync(marker, { recursive: true });
}

function photoSkipReason(message: string): string {
  if (/timed out/i.test(message)) {
    return "Couldn't boot the app in time for a photo. The change is still in the PR.";
  }
  if (/ERESOLVE|legacy-peer-deps|peer dep|npm install failed/i.test(message)) {
    return "Couldn't boot the app for a photo (install). The change is still in the PR.";
  }
  if (/Preview never came up/i.test(message)) {
    return "Couldn't boot the app for a photo. The change is still in the PR.";
  }
  return "Couldn't take a photo. The change is still in the PR.";
}

function killTree(child: ChildProcess) {
  livePreviews.delete(child);
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 2000).unref();
}

export async function captureBefore(
  runId: string,
  playground: Playground,
  route: string,
): Promise<string | undefined> {
  const base = playground.preview.baseUrl;
  if (!base) return undefined;
  const dest = shotPath(runId, "before");
  try {
    const shot = await screenshotUrl(joinUrl(base, route), dest);
    return shot.path;
  } catch (err) {
    log.warn({ err }, "before screenshot failed");
    return undefined;
  }
}

export async function captureAfter(opts: {
  runId: string;
  playground: Playground;
  workspaceDir: string;
  route: string;
  onStatus?: StatusFn;
}): Promise<{ path?: string; phonePath?: string; skippedReason?: string }> {
  const dest = shotPath(opts.runId, "after");
  const { command, url, waitSeconds } = opts.playground.preview;
  let child: ChildProcess | undefined;

  try {
    if (command) {
      const cwd = previewDir(opts.workspaceDir, opts.playground);
      await installDeps(opts.workspaceDir, opts.playground, opts.onStatus);
      const port = await allocatePort();
      const listen = previewListenUrl(url || `http://127.0.0.1:${port}`, port);
      await opts.onStatus?.("Starting the app…");
      child = spawn(command, {
        cwd,
        shell: true,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: previewStartEnv(String(port)),
      });
      livePreviews.add(child);
      let died: Error | undefined;
      child.stdout?.on("data", (b) => log.info({ preview: String(b).slice(0, 240).trim() }, "preview"));
      child.stderr?.on("data", (b) => log.info({ previewErr: String(b).slice(0, 240).trim() }, "preview"));
      child.on("exit", (code, signal) => {
        livePreviews.delete(child!);
        if (code && code !== 0) {
          died = new Error(`preview process exited ${code}${signal ? ` (${signal})` : ""}`);
          log.warn({ code, signal, port }, "preview process exited");
        }
      });
      await waitForUrl(joinUrl(listen, opts.route), waitSeconds || 90, opts.onStatus, () => died);
      await opts.onStatus?.("Taking the photo…");
      const shot = await screenshotUrl(joinUrl(listen, opts.route), dest);
      return { path: shot.path, phonePath: shot.phonePath };
    }

    if (opts.playground.preview.baseUrl) {
      return {
        skippedReason:
          "Couldn't take a live photo of this branch — preview.command is empty. PR is still here.",
      };
    }

    return { skippedReason: "Couldn't get a live photo. The app isn’t set up to boot. PR is still here." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "after screenshot failed");
    return { skippedReason: photoSkipReason(message) };
  } finally {
    if (child) killTree(child);
  }
}
