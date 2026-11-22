import "dotenv/config";
import { webcrypto } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { loadConfig } from "./config.js";
import { openDb, closeDb } from "./db.js";
import { log } from "./logger.js";
import { connectSlack, slackStatus } from "./slack-app.js";
import { startGithubWatch, stopGithubWatch } from "./github-watch.js";
import { slackAdapter } from "./surfaces/slack.js";
import { startJobs } from "./jobs.js";
import { recoverStuckJobs, stopWorker, inflightCount } from "./queue.js";
import { registerGithubWebhook } from "./webhooks.js";
import { overviewPayload, runsPayload } from "./overview.js";
import { githubWriteOk } from "./github.js";
import { llmConfigured, llmBackend, ollamaUp, ollamaModel } from "./llm.js";
import { chromium } from "playwright";
import { killAllPreviews } from "./preview.js";
import type { Run } from "./types.js";
import type { ChatAdapter } from "./surfaces/types.js";

let playwrightOk = false;

function bootEnv() {
  if (!llmConfigured()) {
    throw new Error("Start Ollama (ollama serve && ollama pull qwen2.5-coder:7b) or set MINUTE_LLM_BACKEND=anthropic with ANTHROPIC_API_KEY");
  }
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("Set GITHUB_TOKEN");
  }
  const bot = process.env.SLACK_BOT_TOKEN?.trim() || "";
  const appToken = process.env.SLACK_APP_TOKEN?.trim() || "";
  const signing = process.env.SLACK_SIGNING_SECRET?.trim() || "";
  if (!bot.startsWith("xoxb-") || bot.length < 20) throw new Error("Set SLACK_BOT_TOKEN (xoxb-…)");
  if (!appToken.startsWith("xapp-") || appToken.length < 20) throw new Error("Set SLACK_APP_TOKEN (xapp-…) for Socket Mode");
  if (signing.length < 8) throw new Error("Set SLACK_SIGNING_SECRET");
}

async function verifyDiscordRequest(raw: string, signature: string, timestamp: string, publicKey: string) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(publicKey, "hex"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify(
    "Ed25519",
    key,
    Buffer.from(signature, "hex"),
    Buffer.from(timestamp + raw),
  );
}

function isLocalAddr(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function allowInternal(req: FastifyRequest): boolean {
  const token = process.env.MINUTE_INTERNAL_TOKEN;
  const raw = req.headers.authorization ?? req.headers["x-minute-token"];
  const got = typeof raw === "string" ? raw.replace(/^Bearer\s+/i, "") : "";
  if (token) return got === token;
  return isLocalAddr(req.ip) || isLocalAddr(req.socket.remoteAddress);
}

async function main() {
  bootEnv();
  openDb();
  recoverStuckJobs();
  loadConfig();

  const slack = await connectSlack();
  if (!slack) {
    throw new Error("Slack did not connect. Check SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_SIGNING_SECRET.");
  }
  const wired = loadConfig().playgrounds.some((p) => (p.slackChannelIds ?? []).length > 0);
  if (!wired) log.warn("No slackChannelIds in minute.config.yaml — /minute will not find a playground");
  if (!(loadConfig().admins.slackUserIds ?? []).length) {
    log.warn("No slackUserIds for admins — nobody can run /minute until you add Slack member ids");
  }

  const lookup = async (run: Run): Promise<ChatAdapter | null> => {
    if (!slack || run.surface !== "slack") return null;
    return slackAdapter(slack.client, { channel: run.channelId, threadTs: run.threadId });
  };

  startJobs(lookup);
  startGithubWatch();

  const write = await githubWriteOk();
  const ollama = llmBackend() === "ollama" ? await ollamaUp() : true;
  log.info(
    {
      slack: slackStatus.ready,
      githubWrite: write,
      ollama,
      model: ollamaModel(),
    },
    "boot probes",
  );
  if (!write) log.warn("GitHub token cannot write to the playground repo");
  if (llmBackend() === "ollama" && !ollama) log.warn("Ollama is not reachable — classify/edit will fail");
  try {
    if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    }
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    playwrightOk = true;
  } catch (err) {
    playwrightOk = false;
    log.warn({ err }, "Playwright Chromium missing — photos will be skipped");
  }

  const port = Number(process.env.PORT || 8787);
  const http = Fastify({ logger: false });
  http.get("/health", async () => ({ ok: true }));
  http.get("/ready", async (_req, reply) => {
    try {
      loadConfig();
      const write = await githubWriteOk();
      const body = {
        ok: true,
        inflight: inflightCount(),
        name: loadConfig().name,
        slack: slackStatus.ready,
        githubWrite: write,
        llm: llmConfigured(),
        ollama: llmBackend() === "ollama" ? await ollamaUp() : true,
        playwright: playwrightOk,
        messageContent: true,
      };
      if (!slackStatus.ready || !write || !body.ollama || !playwrightOk) {
        return reply.code(503).send({ ...body, ok: false });
      }
      return body;
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  http.get("/internal/overview", async (req, reply) => {
    if (!allowInternal(req)) return reply.code(401).send({ ok: false });
    return overviewPayload();
  });
  http.get("/internal/runs", async (req, reply) => {
    if (!allowInternal(req)) return reply.code(401).send({ ok: false });
    return runsPayload();
  });
  registerGithubWebhook(http);

  http.post("/interactions", async (req, reply) => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (!publicKey) return reply.code(501).send({ error: "DISCORD_PUBLIC_KEY not set" });
    const sig = req.headers["x-signature-ed25519"];
    const ts = req.headers["x-signature-timestamp"];
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (typeof sig !== "string" || typeof ts !== "string") return reply.code(401).send({ error: "bad signature" });
    const ok = await verifyDiscordRequest(raw, sig, ts, publicKey);
    if (!ok) return reply.code(401).send({ error: "invalid signature" });
    const payload = JSON.parse(raw) as { type?: number };
    if (payload.type === 1) return { type: 1 };
    return reply.code(501).send({ error: "commands are handled on the gateway" });
  });

  await http.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "minute up");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    killAllPreviews();
    stopGithubWatch();
    await stopWorker();
    await slack.stop();
    await http.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log.error({ err }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  log.error({ err }, "uncaughtException");
});
