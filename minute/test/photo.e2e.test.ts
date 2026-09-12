import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { captureAfter, killAllPreviews } from "../src/preview.js";
import type { Playground } from "../src/types.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/mini-preview");

test("captureAfter boots a fixture and writes desktop + phone PNGs", { timeout: 60_000 }, async (t) => {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch {
    t.skip("Playwright Chromium is not installed");
    return;
  }

  const data = mkdtempSync(join(tmpdir(), "minute-photo-data-"));
  process.env.MINUTE_DATA_DIR = data;
  const workspace = mkdtempSync(join(tmpdir(), "minute-photo-ws-"));
  cpSync(fixture, workspace, { recursive: true });

  const playground: Playground = {
    id: "fixture",
    discordChannelIds: [],
    github: { owner: "o", repo: "r", defaultBranch: "main" },
    preview: {
      baseUrl: "",
      command: "node server.js",
      cwd: "",
      url: "http://127.0.0.1:3000",
      waitSeconds: 15,
      defaultRoute: "/",
      install: false,
      installTimeoutSeconds: 30,
    },
    allow: { paths: ["/"], routes: ["/"] },
    refuse: [],
  };

  try {
    const shot = await captureAfter({
      runId: "photo-e2e",
      playground,
      workspaceDir: workspace,
      route: "/",
    });
    assert.equal(shot.skippedReason, undefined, shot.skippedReason);
    assert.ok(shot.path && existsSync(shot.path), "desktop png");
    assert.ok(shot.phonePath && existsSync(shot.phonePath), "phone png");
    assert.ok(statSync(shot.path).size > 100);
    assert.ok(statSync(shot.phonePath).size > 100);
  } finally {
    killAllPreviews();
  }
});
