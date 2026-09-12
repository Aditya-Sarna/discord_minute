import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isAllowedPath, isSafeRepoPath, normalizeRepoPath } from "../src/paths.js";
import { applyPatchOps, applyUniqueReplace, type PatchOp } from "../src/patch.js";
import { clampRequest, LIMITS } from "../src/limits.js";
import { resetDbForTests, closeDb, getDb } from "../src/db.js";
import { saveRun, getRun, claimRun, newRunId } from "../src/store.js";
import { takeToken } from "../src/rate-limit.js";
import { parseTurn, needsRouteClarify, mentionBody, spokenProofCaption, clipChat } from "../src/turns.js";
import { classifyFilename, inferAttachRole } from "../src/attachments.js";
import { filesFromDiff, prBodyFromChange, titleFromChange } from "../src/pr-describe.js";
import { signButton, parseButton, canActOnRun } from "../src/buttons.js";
import { allocatePort, previewDir, isPreviewReady, previewListenUrl } from "../src/preview.js";
import { stakeholderError } from "../src/errors.js";
import {
  MINUTE_GOLD,
  MINUTE_GREEN,
  askModal,
  kickoffEmbed,
  pickEmbed,
  pickRow,
  proofEmbed,
  proofFiles,
  scratchModal,
  statusEmbed,
  statusTitle,
  threadTitle,
} from "../src/surfaces/discord-ui.js";
import { discordAdapter } from "../src/surfaces/discord.js";
import {
  trySimpleVisualEdit,
  parseSimpleVisual,
  parseSimpleHide,
  parseSimpleType,
  parseSimpleCopy,
  parseSimpleShift,
  parseRepeatTarget,
  parseUndo,
  parseShowMobile,
  shiftHex,
} from "../src/simple-edit.js";
import { handleSignedAction } from "../src/conversation.js";
import {
  inferRunKind,
  looksLikeInventory,
  looksLikeWhereLive,
  parseGithubUrl,
  parseShowFileAsk,
  PICK_ASK,
  questionFromAsk,
  renderPointerAnswer,
  selectRepoFiles,
  snippetFromRepo,
  splitAnswer,
} from "../src/ask.js";
import { extractPhotoUrls, fetchScratchPhotos, isPublicHttpsUrl, stockPhotoUrls } from "../src/photos.js";
import {
  classifyScratch,
  looksLikeScratchAsk,
  overlayScratchPlayground,
  parseScratchIntent,
  scratchRepoName,
  writeScratchApp,
  writeScratchScaffold,
  MODAL_SCRATCH,
  PICK_SCRATCH,
  PICK_TWEAK,
} from "../src/scratch.js";
import type { Playground, Proof, Run } from "../src/types.js";

test("path allowlist blocks traversal", () => {
  const allow = ["src/", "app/"];
  assert.equal(isAllowedPath("src/page.tsx", allow), true);
  assert.equal(isAllowedPath("app/x.ts", allow), true);
  assert.equal(isAllowedPath("../etc/passwd", allow), false);
  assert.equal(isAllowedPath("src/../../secrets", allow), false);
  assert.equal(isAllowedPath(".git/config", allow), false);
  assert.equal(isAllowedPath("infra/main.tf", allow), false);
  assert.equal(isAllowedPath("/frontend/src/index.css", ["frontend/src/"]), true);
  assert.equal(isAllowedPath("/etc/passwd", ["frontend/src/"]), false);
  assert.equal(isSafeRepoPath("/frontend/src/index.css"), true);
  assert.equal(isSafeRepoPath("../etc/passwd"), false);
  assert.equal(normalizeRepoPath("./src/a.ts"), "src/a.ts");
  assert.equal(normalizeRepoPath("/frontend/src/index.css"), "frontend/src/index.css");
});

test("duplicate search picks hinted occurrence", () => {
  const css = "header { color: red; }\nfooter { color: red; }\n";
  assert.equal(
    applyUniqueReplace(css, "color: red;", "color: green;", "make the header green"),
    "header { color: green; }\nfooter { color: red; }\n",
  );
  assert.equal(
    applyUniqueReplace(css, "color: red;", "color: green;", "footer"),
    "header { color: red; }\nfooter { color: green; }\n",
  );
});

test("duplicate identical lines still apply once", () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-"));
  writeFileSync(join(dir, "a.css"), "color: red;\ncolor: red;\n");
  applyPatchOps(dir, ["a.css"], [
    { kind: "replace", path: "a.css", search: "color: red;", replace: "color: green;" },
  ]);
  assert.equal(readFileSync(join(dir, "a.css"), "utf8"), "color: green;\ncolor: red;\n");
  writeFileSync(join(dir, "b.css"), "color: red;\n");
  applyPatchOps(dir, ["b.css"], [
    { kind: "replace", path: "b.css", search: "color: red;", replace: "color: green;" },
  ]);
  assert.equal(readFileSync(join(dir, "b.css"), "utf8"), "color: green;\n");
});

test("patch create stays in playground", () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-"));
  mkdirSync(join(dir, "src"));
  assert.throws(() =>
    applyPatchOps(dir, ["src/"], [{ kind: "create", path: "secrets.env", content: "x" }]),
  );
  applyPatchOps(dir, ["src/"], [{ kind: "create", path: "src/notes.tsx", content: "export default 1" }]);
  assert.equal(readFileSync(join(dir, "src/notes.tsx"), "utf8"), "export default 1");
});

test("leading slash is repo-relative, not filesystem root", () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-"));
  mkdirSync(join(dir, "frontend/src"), { recursive: true });
  writeFileSync(join(dir, "frontend/src/index.css"), "color: red;\n");
  applyPatchOps(dir, ["frontend/src/"], [
    { kind: "replace", path: "/frontend/src/index.css", search: "red", replace: "green" },
  ]);
  assert.equal(readFileSync(join(dir, "frontend/src/index.css"), "utf8"), "color: green;\n");
});

test("clampRequest strips and caps", () => {
  assert.equal(clampRequest("  hi\0  "), "hi");
  assert.equal(clampRequest("x".repeat(LIMITS.requestChars + 50)).length, LIMITS.requestChars);
});

test("sqlite run claim", () => {
  const file = join(mkdtempSync(join(tmpdir(), "minute-db-")), "t.sqlite");
  resetDbForTests(file);
  const run: Run = {
    id: newRunId(),
    surface: "discord",
    channelId: "C1",
    threadId: "T1",
    parentMessageId: "T1",
    requesterId: "U1",
    requesterName: "priya",
    playgroundId: "website",
    request: "green",
    status: "proof",
    branch: "b",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveRun(run);
  assert.equal(getRun(run.id)?.status, "proof");
  assert.ok(claimRun(run.id, "proof", "working"));
  assert.equal(getRun(run.id)?.status, "working");
  assert.equal(claimRun(run.id, "proof", "working"), undefined);
  closeDb();
});

test("rate limit", () => {
  const file = join(mkdtempSync(join(tmpdir(), "minute-db-")), "r.sqlite");
  resetDbForTests(file);
  assert.equal(takeToken("u1", 2), true);
  assert.equal(takeToken("u1", 2), true);
  assert.equal(takeToken("u1", 2), false);
  closeDb();
});

test("parseTurn: looks good and cancel are english", () => {
  assert.equal(parseTurn("looks good", false).kind, "handoff");
  assert.equal(parseTurn("LGTM", false).kind, "handoff");
  assert.equal(parseTurn("ship it", false).kind, "handoff");
  assert.equal(parseTurn("cancel", false).kind, "cancel");
  assert.equal(parseTurn("nevermind", false).kind, "cancel");
  assert.equal(parseTurn("a bit darker", false).kind, "tweak");
  assert.equal(parseTurn("undo that", false).kind, "undo");
  assert.equal(parseTurn("show me mobile", false).kind, "mobile");
  assert.equal(parseTurn("", true).kind, "need_attach_intent");
});

test("mentionBody strips bot mention", () => {
  assert.equal(mentionBody("<@123> make it green", "123"), "make it green");
});

test("needsRouteClarify", () => {
  assert.equal(needsRouteClarify("green header", ["/", "/notes"]), true);
  assert.equal(needsRouteClarify("notes tab", ["/", "/notes"]), false);
  assert.equal(needsRouteClarify("homepage green", ["/", "/notes"]), false);
});

test("spokenProofCaption", () => {
  const s = spokenProofCaption({ summary: "Forest green header", using: ["mock.png"] });
  assert.match(s, /Forest green/);
  assert.match(s, /mock\.png/);
  assert.match(s, /is this it/);
  const long = spokenProofCaption({
    summary: "Header",
    skippedReason: "x".repeat(5000),
  });
  assert.ok(long.length <= 1900);
  assert.equal(clipChat("ok"), "ok");
});

test("attachments: classify and infer", () => {
  assert.equal(classifyFilename("mock.png"), "match");
  assert.equal(classifyFilename("notes.pdf"), "spec");
  assert.equal(classifyFilename("logo.svg"), "asset");
  assert.equal(classifyFilename("virus.exe"), "refuse");
  assert.equal(inferAttachRole("more like this", ["a.png"]), "match");
  assert.equal(inferAttachRole("put this in the header", ["logo.svg"]), "asset");
  assert.equal(inferAttachRole("", ["a.png"]), "need_intent");
});

test("buttons: sign, parse, ACL", () => {
  const id = signButton("looks_good", "run-1");
  const parsed = parseButton(id);
  assert.ok(parsed);
  assert.equal(parsed?.action, "looks_good");
  assert.equal(parsed?.runId, "run-1");
  assert.equal(parseButton("minute:looks_good:run-1"), undefined);
  assert.equal(canActOnRun({ userId: "a", requesterId: "a", isAdmin: false }), true);
  assert.equal(canActOnRun({ userId: "b", requesterId: "a", isAdmin: false }), false);
  assert.equal(canActOnRun({ userId: "b", requesterId: "a", isAdmin: true }), true);
});

test("PR body describes the change, not the chat diary", () => {
  const diff = `diff --git a/frontend/src/index.css b/frontend/src/index.css
index 111..222 100644
--- a/frontend/src/index.css
+++ b/frontend/src/index.css
@@ -1 +1 @@
-color: red;
+color: green;
`;
  assert.deepEqual(filesFromDiff(diff), ["frontend/src/index.css"]);
  assert.equal(titleFromChange("forest green homepage header"), "minute: forest green homepage header");
  const playground: Playground = {
    id: "web",
    discordChannelIds: ["1"],
    github: { owner: "o", repo: "r", defaultBranch: "main" },
    preview: {
      baseUrl: "",
      command: "npm start",
      cwd: "frontend",
      url: "http://localhost:3000",
      waitSeconds: 45,
      defaultRoute: "/",
      install: true,
      installTimeoutSeconds: 240,
    },
    allow: { paths: ["frontend/src/"], routes: ["/"] },
    refuse: [],
  };
  const run: Run = {
    id: "minute-1",
    surface: "discord",
    channelId: "c",
    threadId: "t",
    parentMessageId: "p",
    requesterId: "u",
    requesterName: "Priya",
    playgroundId: "web",
    request: "green\n\nTweak: darker\n\nTweak: homepage only",
    originalAsk: "make the header green",
    status: "proof",
    branch: "minute-1",
    attachmentNotes: ["mock.png (match)"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const proof: Proof = {
    caption: "Forest green homepage header",
    route: "/",
    filesChanged: ["frontend/src/index.css"],
    afterPath: "/tmp/after.png",
  };
  const body = prBodyFromChange({
    playground,
    run,
    summary: "Homepage header is forest green in frontend/src/index.css.",
    diff,
    proof,
    signedOff: false,
    threadUrl: "https://discord.com/channels/1/t",
  });
  assert.match(body, /What changed/);
  assert.match(body, /index\.css/);
  assert.doesNotMatch(body, /Tweak: darker/);
  assert.match(body, /mock\.png/);
  assert.match(body, /Priya/);
  assert.match(body, /\*\*Visual sign-off:\*\* not yet/);
});

test("stakeholderError hides git dump", () => {
  const msg = stakeholderError(
    "Pushing to https://github.com/Aditya-Sarna/llmwatermarking.git\nremote: Permission to Aditya-Sarna/llmwatermarking.git denied to Aditya-Sarna.\nfatal: unable to access 'https://github.com/Aditya-Sarna/llmwatermarking.git/': The requested URL returned error: 403\n",
  );
  assert.match(msg, /GitHub refused the push/);
  assert.doesNotMatch(msg, /fatal: unable to access/);
});

test("previewDir uses frontend when package.json is nested", () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-preview-"));
  mkdirSync(join(dir, "frontend"));
  writeFileSync(join(dir, "frontend/package.json"), "{}");
  const playground: Playground = {
    id: "web",
    discordChannelIds: [],
    github: { owner: "o", repo: "r", defaultBranch: "main" },
    preview: {
      baseUrl: "",
      command: "npm start",
      cwd: "",
      url: "http://localhost:3000",
      waitSeconds: 45,
      defaultRoute: "/",
      install: true,
      installTimeoutSeconds: 240,
    },
    allow: { paths: ["frontend/src/"], routes: ["/"] },
    refuse: [],
  };
  assert.equal(previewDir(dir, playground), join(dir, "frontend"));
  playground.preview.cwd = "frontend";
  assert.equal(previewDir(dir, playground), join(dir, "frontend"));
});

test("previewListenUrl pins host and allocated port", () => {
  assert.equal(previewListenUrl("http://localhost:3055", 41234), "http://127.0.0.1:41234/");
  assert.equal(previewListenUrl("http://0.0.0.0:3000/app", 9), "http://127.0.0.1:9/app");
});

test("isPreviewReady ignores compile splash", () => {
  assert.equal(isPreviewReady(200, "<html>Compiling...</html>"), false);
  assert.equal(isPreviewReady(200, "<html><title>App</title></html>"), true);
  assert.equal(isPreviewReady(404, "Not found"), false);
  assert.equal(isPreviewReady(500, "oops"), false);
  assert.equal(isPreviewReady(200, JSON.stringify({ webpack: { hasCompiled: true, isHealthy: true } })), true);
  assert.equal(isPreviewReady(200, JSON.stringify({ webpack: { hasCompiled: false } })), false);
});

test("discord UI cards are branded Minute", () => {
  assert.equal(statusTitle("Installing packages for the photo…"), "Booting the app");
  assert.equal(statusTitle("Taking the photo…"), "Taking the photo");
  assert.equal(threadTitle("make the header green"), "Minute · make the header green");
  const kickoff = kickoffEmbed({ ask: "make the header green", requesterTag: "<@1>" }).toJSON();
  assert.equal(kickoff.color, MINUTE_GOLD);
  assert.equal(kickoff.author?.name, "Minute");
  assert.equal(kickoff.title, "On it");
  const status = statusEmbed("Starting the app… 20s").toJSON();
  assert.equal(status.title, "Booting the app");
  const shotDir = mkdtempSync(join(tmpdir(), "minute-shot-"));
  const afterPath = join(shotDir, "after.png");
  const phonePath = join(shotDir, "phone.png");
  writeFileSync(afterPath, "png");
  writeFileSync(phonePath, "png");
  const proof: Proof = {
    caption: "Forest green header",
    route: "/",
    filesChanged: ["frontend/src/index.css"],
    afterPath,
    phonePath,
  };
  const run: Run = {
    id: "minute-1",
    surface: "discord",
    channelId: "c",
    threadId: "t",
    parentMessageId: "p",
    requesterId: "u",
    requesterName: "Priya",
    playgroundId: "web",
    request: "green",
    status: "proof",
    branch: "b",
    prUrl: "https://github.com/o/r/pull/1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const card = proofEmbed(proof, run).toJSON();
  assert.equal(card.title, "Here's the photo");
  assert.equal(card.image?.url, "attachment://after.png");
  assert.equal(card.thumbnail?.url, "attachment://after-phone.png");
  assert.equal(card.color, MINUTE_GOLD);
  const signed = proofEmbed(proof, run, { signedOff: "Priya signed off." }).toJSON();
  assert.equal(signed.title, "Signed off");
  assert.equal(signed.color, MINUTE_GREEN);
  const files = proofFiles(proof);
  assert.deepEqual(
    files.map((f) => f.name),
    ["after.png", "after-phone.png"],
  );
  assert.equal(proofFiles({ ...proof, afterPath: "/no/such/after.png", phonePath: "/no/such/phone.png" }).length, 0);
  const modal = askModal().toJSON();
  assert.equal(modal.custom_id, "minute:modal:ask");
  assert.equal(modal.title, "Minute");
});

test("discordAdapter posts after.png on the proof card", async () => {
  const shotDir = mkdtempSync(join(tmpdir(), "minute-discord-proof-"));
  const afterPath = join(shotDir, "after.png");
  writeFileSync(afterPath, "png");
  const sent: unknown[] = [];
  const adapter = discordAdapter({
    send: async (payload) => {
      sent.push(payload);
      return { id: "msg-1" };
    },
  });
  const run: Run = {
    id: "minute-proof-send",
    surface: "discord",
    channelId: "c",
    threadId: "t",
    parentMessageId: "p",
    requesterId: "u",
    requesterName: "Priya",
    playgroundId: "web",
    request: "green",
    status: "proof",
    branch: "b",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = await adapter.postProof(
    { caption: "green header", route: "/", filesChanged: ["frontend/src/index.css"], afterPath },
    run,
  );
  assert.equal(id, "msg-1");
  const payload = sent[0] as { files: { name: string }[]; embeds: { data?: { image?: { url?: string } } }[] };
  assert.equal(payload.files[0]?.name, "after.png");
});

test("identity: phone and email normalize", async () => {
  const { normalizePhone, normalizeEmail, phonesEqual, emailsEqual } = await import("../src/identity.js");
  assert.equal(normalizePhone("+1 (555) 000-1212"), "15550001212");
  assert.ok(phonesEqual("+1-555-000-1212", "15550001212"));
  assert.equal(normalizeEmail("Priya <priya@Co.com>"), "priya@co.com");
  assert.ok(emailsEqual("priya@co.com", "Priya <priya@Co.com>"));
});

test("simple visual edit paints header green without an LLM", () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-css-"));
  mkdirSync(join(dir, "frontend/src"), { recursive: true });
  writeFileSync(join(dir, "frontend/src/index.css"), "header { color: red; }\n");
  assert.deepEqual(parseSimpleVisual("make the header green"), {
    target: "header",
    color: "green",
    hex: "#228B22",
  });
  const result = trySimpleVisualEdit(dir, ["frontend/src/"], "make the header green");
  assert.ok(result);
  assert.equal(result?.files[0], "frontend/src/index.css");
  assert.match(readFileSync(join(dir, "frontend/src/index.css"), "utf8"), /#228B22/);
  assert.equal(parseSimpleVisual("make the header green and add a login page"), undefined);
  assert.deepEqual(parseSimpleHide("hide the badge"), { target: "badge" });
  assert.equal(trySimpleVisualEdit(dir, ["frontend/src/"], "hide the header")?.summary, "hide header");
  assert.match(readFileSync(join(dir, "frontend/src/index.css"), "utf8"), /display:\s*none/);
  writeFileSync(join(dir, "frontend/src/index.css"), "header { color: red; font-size: 1rem; }\n");
  assert.equal(parseSimpleType("bigger type")?.size, "1.35em");
  assert.ok(trySimpleVisualEdit(dir, ["frontend/src/"], "bigger type"));
  assert.match(readFileSync(join(dir, "frontend/src/index.css"), "utf8"), /1\.35em/);
  assert.equal(parseSimpleShift("a bit darker")?.mode, "darker");
  assert.match(shiftHex("#228B22", "darker"), /^#[0-9a-f]{6}$/i);
  assert.notEqual(shiftHex("#228B22", "darker").toLowerCase(), "#228b22");
  writeFileSync(join(dir, "frontend/src/index.css"), "header { color: #228B22; }\n");
  const darkened = trySimpleVisualEdit(dir, ["frontend/src/"], "a bit darker", {
    kind: "color",
    target: "header",
    hex: "#228B22",
    summary: "header green",
  });
  assert.ok(darkened);
  assert.match(readFileSync(join(dir, "frontend/src/index.css"), "utf8"), /#1b6c1b|#1a6c1a|#1b6c1a/i);
  writeFileSync(join(dir, "frontend/src/index.html"), "<h1>Hello</h1>\n");
  assert.equal(parseSimpleCopy('say "Welcome back" instead')?.next, "Welcome back");
  assert.ok(trySimpleVisualEdit(dir, ["frontend/src/"], 'say "Welcome back" instead'));
  assert.match(readFileSync(join(dir, "frontend/src/index.html"), "utf8"), /Welcome back/);
  assert.equal(parseRepeatTarget("do that to the footer too"), "footer");
  assert.equal(parseUndo("undo that"), true);
  assert.equal(parseShowMobile("show me mobile"), true);
});

test("handleSignedAction enqueues handoff", () => {
  const file = join(mkdtempSync(join(tmpdir(), "minute-act-")), "t.sqlite");
  resetDbForTests(file);
  const run: Run = {
    id: "minute-act-1",
    surface: "discord",
    channelId: "c",
    threadId: "t",
    parentMessageId: "p",
    requesterId: "u1",
    requesterName: "Priya",
    playgroundId: "web",
    request: "green",
    status: "proof",
    branch: "b",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveRun(run);
  const id = signButton("looks_good", run.id);
  assert.equal(handleSignedAction({ customId: id, userId: "u1" }), undefined);
  const job = getDb()
    .prepare("SELECT type, run_id, status FROM jobs")
    .get() as { type: string; run_id: string; status: string };
  assert.equal(job.type, "handoff");
  assert.equal(job.run_id, run.id);
  assert.equal(job.status, "queued");
  closeDb();
});

test("scratch: slug, intent, refuse, scaffold, Discord picker", () => {
  assert.equal(scratchRepoName("A notes page for my class", "class-notes"), "class-notes");
  assert.equal(scratchRepoName("!!!"), "minute-project");
  assert.ok(looksLikeScratchAsk("start a new project for class notes"));
  assert.ok(looksLikeScratchAsk("create a new repo"));
  assert.equal(looksLikeScratchAsk("make the header green"), false);

  const playground: Playground = {
    id: "web",
    discordChannelIds: [],
    github: { owner: "o", repo: "r", defaultBranch: "main" },
    preview: {
      baseUrl: "",
      command: "npm start",
      cwd: "frontend",
      url: "http://localhost:3000",
      waitSeconds: 45,
      defaultRoute: "/",
      install: true,
      installTimeoutSeconds: 240,
    },
    allow: { paths: ["frontend/src/"], routes: ["/"] },
    refuse: ["payments"],
  };
  assert.equal(classifyScratch("a notes page for class", playground).ok, true);
  assert.equal(classifyScratch("create a login page for a food app", playground).ok, true);
  assert.equal(classifyScratch("restaurant homepage", playground).ok, true);
  assert.equal(classifyScratch("add stripe payments", playground).ok, false);
  assert.deepEqual(parseScratchIntent("create a login page for a food app").page, "login");
  assert.equal(parseScratchIntent("create a login page for a food app").theme, "food");
  assert.equal(scratchRepoName("create a login page for a food app"), "food-app");
  const ultra = parseScratchIntent('create a checkout page for a finance app called "ultra pay".');
  assert.equal(ultra.page, "checkout");
  assert.equal(ultra.theme, "finance");
  assert.equal(ultra.brand, "Ultra Pay");
  assert.doesNotMatch(ultra.tagline, /create a checkout/i);
  assert.equal(ultra.repoName, "ultra-pay");
  assert.equal(classifyScratch('create a checkout page for a finance app called "ultra pay".', playground).ok, true);
  const mo = parseScratchIntent('create a fashion app called "mo"');
  assert.equal(mo.theme, "fashion");
  assert.equal(mo.page, "home");
  assert.equal(mo.brand, "Mo");
  assert.doesNotMatch(mo.tagline, /first version/i);

  const over = overlayScratchPlayground(playground, { owner: "o", repo: "class-notes", defaultBranch: "main" });
  assert.equal(over.github.repo, "class-notes");
  assert.equal(over.preview.command, "node server.js");
  assert.ok(over.allow.paths.includes("public/"));

  const dir = mkdtempSync(join(tmpdir(), "minute-scratch-"));
  writeScratchScaffold(dir, { title: "Class notes", blurb: "A notes page for my class" });
  assert.match(readFileSync(join(dir, "public/index.html"), "utf8"), /Class Notes/);
  assert.ok(readFileSync(join(dir, "server.js"), "utf8").includes("127.0.0.1"));

  const foodDir = mkdtempSync(join(tmpdir(), "minute-food-"));
  const built = writeScratchApp(foodDir, "create a login page for a food app");
  assert.match(readFileSync(join(foodDir, "public/index.html"), "utf8"), /Sign in/);
  assert.match(readFileSync(join(foodDir, "public/index.html"), "utf8"), /type="email"/);
  assert.ok(built.files.includes("public/index.html"));

  const payDir = mkdtempSync(join(tmpdir(), "minute-pay-"));
  writeScratchApp(payDir, 'create a checkout page for a finance app called "ultra pay".');
  const payHtml = readFileSync(join(payDir, "public/index.html"), "utf8");
  assert.match(payHtml, /Ultra Pay/);
  assert.match(payHtml, /Pay \$48/);
  assert.doesNotMatch(payHtml, /create a checkout page/i);

  const moDir = mkdtempSync(join(tmpdir(), "minute-mo-"));
  writeScratchApp(moDir, 'create a fashion app called "mo"');
  const moHtml = readFileSync(join(moDir, "public/index.html"), "utf8");
  assert.match(moHtml, />Mo</);
  assert.match(moHtml, /Shop the drop/);
  assert.match(moHtml, /Silk slip/);
  assert.doesNotMatch(moHtml, /first version/i);
  assert.doesNotMatch(moHtml, /Reply in the thread/i);

  assert.equal(statusTitle("Creating a new GitHub repo…"), "Creating the repo");
  assert.equal(threadTitle("class notes", "scratch"), "Minute · new · class notes");
  const kick = kickoffEmbed({ ask: "class notes", requesterTag: "<@1>", kind: "scratch" }).toJSON();
  assert.equal(kick.title, "New project");
  const pick = pickEmbed().toJSON();
  assert.equal(pick.title, "What kind of Minute?");
  const row = pickRow().toJSON();
  assert.deepEqual(
    row.components?.map((c) => (c as { custom_id?: string }).custom_id),
    [PICK_TWEAK, PICK_SCRATCH, PICK_ASK],
  );
  assert.equal(scratchModal().toJSON().custom_id, MODAL_SCRATCH);
  assert.equal(stakeholderError("Could not create a GitHub repo with that name."), "Couldn’t create a GitHub repo with that name. Try a shorter name, or ping tech.");
});

test("scratch food login is served as HTML, not Not found", async () => {
  const dir = mkdtempSync(join(tmpdir(), "minute-food-http-"));
  writeScratchApp(dir, "create a login page for a food app");
  const port = await allocatePort();
  const child = spawn("node", ["server.js"], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  try {
    let html = "";
    let status = 0;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        status = res.status;
        html = await res.text();
        if (status === 200) break;
      } catch {
        // booting
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(status, 200);
    assert.match(html, /Sign in/);
    assert.doesNotMatch(html, /Not found/);
  } finally {
    child.kill("SIGTERM");
  }
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("scratch photos: extract urls, block private hosts, use attached stills", async () => {
  assert.equal(isPublicHttpsUrl("https://images.unsplash.com/photo-1"), true);
  assert.equal(isPublicHttpsUrl("http://images.unsplash.com/photo-1"), false);
  assert.equal(isPublicHttpsUrl("https://127.0.0.1/x.jpg"), false);
  assert.equal(isPublicHttpsUrl("https://192.168.1.4/x.jpg"), false);
  assert.equal(isPublicHttpsUrl("https://localhost/x.jpg"), false);
  assert.ok(stockPhotoUrls("fashion").length >= 5);
  assert.deepEqual(
    extractPhotoUrls('use https://images.unsplash.com/photo-1?w=800 and http://evil.example/x.jpg done.'),
    ["https://images.unsplash.com/photo-1?w=800"],
  );
  assert.deepEqual(extractPhotoUrls("https://192.168.0.5/look.jpg"), []);

  const dir = mkdtempSync(join(tmpdir(), "minute-photos-"));
  const look = join(dir, "look.png");
  const coat = join(dir, "coat.png");
  writeFileSync(look, TINY_PNG);
  writeFileSync(coat, TINY_PNG);
  const photos = await fetchScratchPhotos(dir, {
    theme: "fashion",
    skipStock: true,
    attachments: [
      { name: "look.png", localPath: look },
      { name: "coat.png", localPath: coat },
    ],
  });
  assert.match(photos.hero || "", /\/photos\//);
  assert.equal(photos.items.length, 1);
  assert.ok(existsSync(join(dir, "public/photos/p0.png")));

  const built = writeScratchApp(dir, 'create a fashion app called "mo"', undefined, { photos });
  const html = readFileSync(join(dir, "public/index.html"), "utf8");
  assert.match(html, /has-photo/);
  assert.match(html, /\/photos\/p0\.png/);
  assert.match(html, /<img src="\/photos\/p1\.png"/);
  assert.ok(built.files.some((f) => f.startsWith("public/photos/")));

  const offline = mkdtempSync(join(tmpdir(), "minute-photos-off-"));
  const stills = await fetchScratchPhotos(offline, { theme: "fashion", skipStock: true });
  assert.match(stills.hero || "", /\.svg$/);
  assert.equal(stills.items.length, 4);
  assert.match(readFileSync(join(offline, "public/photos/p0.svg"), "utf8"), /<svg/);
  assert.match(readFileSync(join(dir, "server.js"), "utf8"), /\.jpg/);
});

test("ask: parse GitHub links, infer kind, rank files", () => {
  const blob = parseGithubUrl(
    "how is auth done in https://github.com/Aditya-Sarna/llmwatermarking/blob/main/src/queue.ts ?",
  );
  assert.equal(blob?.owner, "Aditya-Sarna");
  assert.equal(blob?.repo, "llmwatermarking");
  assert.equal(blob?.ref, "main");
  assert.equal(blob?.path, "src/queue.ts");

  const pr = parseGithubUrl("https://github.com/foo/bar/pull/12 explain the approach");
  assert.equal(pr?.pr, 12);
  assert.equal(parseGithubUrl("https://github.com/settings/profile"), undefined);
  assert.equal(parseGithubUrl("https://evil.com/github.com/foo/bar"), undefined);

  assert.equal(
    questionFromAsk("https://github.com/foo/bar how does checkout work?"),
    "how does checkout work?",
  );
  assert.match(questionFromAsk("https://github.com/foo/bar"), /overview/);

  const playground = { github: { owner: "Aditya-Sarna", repo: "llmwatermarking" } };
  assert.equal(
    inferRunKind("https://github.com/vercel/next.js how does routing work?", playground),
    "ask",
  );
  assert.equal(
    inferRunKind("https://github.com/Aditya-Sarna/llmwatermarking how is the queue implemented?", playground),
    "ask",
  );
  assert.equal(inferRunKind("make the header green", playground), "tweak");
  assert.equal(inferRunKind("start a new project for notes", playground), "scratch");
  assert.equal(inferRunKind("https://github.com/foo/bar explain this", playground, "tweak"), "tweak");

  const dir = mkdtempSync(join(tmpdir(), "minute-ask-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "src/queue.ts"), "export function enqueue() { return 1 }\n");
  writeFileSync(join(dir, "src/other.ts"), "export const x = 2\n");
  const picked = selectRepoFiles(dir, "how does the queue work?", "src/queue.ts");
  assert.equal(picked[0]?.path, "src/queue.ts");
  assert.ok(picked.some((f) => f.path === "README.md") || picked.length >= 1);

  assert.deepEqual(splitAnswer("short"), ["short"]);
  assert.ok(splitAnswer("a\n\n".repeat(2000)).length >= 2);
  assert.equal(statusTitle("Reading the repo…"), "Reading the repo");
  assert.equal(threadTitle("https://github.com/foo/bar how?", "ask"), "Minute · ask · foo/bar");
  assert.equal(kickoffEmbed({ ask: "how?", requesterTag: "<@1>", kind: "ask" }).toJSON().title, "Reading the repo");
  assert.equal(stakeholderError("GitHub repo not found."), "I can’t see that GitHub repo. It may be private, or the link is wrong.");

  const walk = renderPointerAnswer({
    lede: "A ViT paper repo that measures spatial geometry vs corruption robustness.",
    start: { path: "code/src/main/model.py", name: "VisionTransformer.forward", why: "this is where PE variants actually get applied" },
    steps: [
      { path: "code/src/metrics/ssdc.py", name: "evaluate_ssdc", what: "hooks attention inputs and scores spatial geometry" },
      { path: "code/src/metrics/robustness.py", name: "evaluate_robustness_jpeg", what: "fragility is 1 minus corrupted/clean accuracy" },
    ],
    idea: "Positional encodings are treated as a spatial reference frame, not a accuracy trick.",
  });
  assert.match(walk, /\*\*Start here\*\*/);
  assert.match(walk, /model\.py/);
  assert.match(walk, /evaluate_ssdc/);
  assert.equal(looksLikeInventory("#### JPEG\nFunction: foo\nFile: bar"), true);
  assert.equal(looksLikeInventory(walk), false);

  assert.equal(parseShowFileAsk("show me src/queue.ts"), "src/queue.ts");
  assert.equal(looksLikeWhereLive("where would this change live?"), true);
  const shown = snippetFromRepo(dir, "src/queue.ts");
  assert.match(shown || "", /enqueue/);
});
