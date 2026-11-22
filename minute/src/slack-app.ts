import { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { isAdmin, isRequester, listGranted, denyMessage, grant, revoke } from "./access.js";
import { handleSignedAction, beginSurfaceRun } from "./conversation.js";
import { loadConfig, repoLabel } from "./config.js";
import { downloadAttachment } from "./download.js";
import { log } from "./logger.js";
import { rateLimitedMessage, takeIterateToken, takeStartToken } from "./rate-limit.js";
import { claimRun, getRun, runByThread, busyRunInThread, saveRun } from "./store.js";
import { slackAdapter } from "./surfaces/slack.js";
import { busyAck, mentionBody, parseTurn } from "./turns.js";
import { enqueueCancel, enqueueHandoff, enqueueIterate, enqueueUndo } from "./jobs.js";
import { canActOnRun, signButton } from "./buttons.js";
import type { Attachment } from "./types.js";

export const slackStatus = {
  ready: false,
  userTag: "",
  botUserId: "",
};

type SlackFile = {
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
};

type Kind = "tweak" | "scratch" | "ask";

function token(): string {
  return process.env.SLACK_BOT_TOKEN || "";
}

function threadUrl(channelId: string, threadTs: string): string {
  return `https://slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;
}

async function slackFiles(files: SlackFile[] | undefined, folder: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const file of files ?? []) {
    const url = file.url_private_download || file.url_private;
    if (!url || !file.name) continue;
    out.push(
      await downloadAttachment(folder, { name: file.name, url, contentType: file.mimetype }, {
        Authorization: `Bearer ${token()}`,
      }),
    );
  }
  return out;
}

async function displayName(client: WebClient, userId: string, fallback?: string): Promise<string> {
  if (fallback) return fallback;
  try {
    const info = await client.users.info({ user: userId });
    return info.user?.profile?.display_name || info.user?.real_name || info.user?.name || userId;
  } catch {
    return userId;
  }
}

async function startMinute(opts: {
  client: WebClient;
  userId: string;
  userName: string;
  channelId: string;
  text: string;
  files?: Attachment[];
  kind?: Kind;
  replyTo?: string;
}): Promise<string | undefined> {
  if (!isRequester("slack", opts.userId)) return denyMessage();
  if (!takeStartToken("slack", opts.userId)) return rateLimitedMessage();
  return beginSurfaceRun({
    surface: "slack",
    userId: opts.userId,
    userName: opts.userName,
    channelId: opts.channelId,
    text: opts.text,
    files: opts.files,
    kind: opts.kind,
    threadUrl: (threadTs) => threadUrl(opts.channelId, threadTs),
    openThread: async () => {
      const posted = await opts.client.chat.postMessage({
        channel: opts.channelId,
        thread_ts: opts.replyTo,
        text: `On it — ${(opts.text || opts.files?.[0]?.name || "new Minute").slice(0, 180)}`,
      });
      const ts = posted.ts;
      if (!ts) throw new Error("Slack did not return a thread id");
      const threadId = opts.replyTo || ts;
      return {
        threadId,
        parentId: ts,
        chat: slackAdapter(opts.client, { channel: opts.channelId, threadTs: threadId, statusTs: ts }),
      };
    },
  });
}

function requestModal(kind: Kind, channel: string) {
  const title = kind === "scratch" ? "New scratch" : kind === "ask" ? "Ask the repo" : "Change";
  return {
    type: "modal" as const,
    callback_id: "minute_start",
    private_metadata: JSON.stringify({ kind, channel }),
    title: { type: "plain_text" as const, text: title },
    submit: { type: "plain_text" as const, text: "Start" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "input" as const,
        block_id: "request",
        label: { type: "plain_text" as const, text: "What should change?" },
        element: { type: "plain_text_input" as const, action_id: "text", multiline: true },
      },
    ],
  };
}

export async function connectSlack() {
  const bot = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!bot || !appToken || !signingSecret) return null;

  const app = new App({
    token: bot,
    appToken,
    signingSecret,
    socketMode: true,
  });

  app.command("/minute", async ({ command, ack, respond, client }) => {
    await ack();
    try {
      const text = (command.text || "").trim();
      const userName = await displayName(client, command.user_id, command.user_name);
      if (command.thread_ts && text) {
        await onThreadReply(client, {
          channel: command.channel_id,
          threadTs: command.thread_ts,
          userId: command.user_id,
          text,
          files: [],
        });
        return;
      }
      if (!text) {
        await respond({
          response_type: "ephemeral",
          text: "What do you want to do?",
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "What do you want to do?" } },
            {
              type: "actions",
              block_id: "pick",
              elements: [
                { type: "button", text: { type: "plain_text", text: "Change the playground" }, action_id: "pick_tweak", value: "tweak" },
                { type: "button", text: { type: "plain_text", text: "New scratch" }, action_id: "pick_scratch", value: "scratch" },
                { type: "button", text: { type: "plain_text", text: "Ask the repo" }, action_id: "pick_ask", value: "ask" },
              ],
            },
          ],
        });
        return;
      }
      const err = await startMinute({
        client,
        userId: command.user_id,
        userName,
        channelId: command.channel_id,
        text,
      });
      if (err) await respond({ response_type: "ephemeral", text: err });
    } catch (err) {
      log.error({ err }, "slack /minute");
      await respond({ response_type: "ephemeral", text: "Something went wrong. Try again." });
    }
  });

  app.command("/minute-admin", async ({ command, ack, respond }) => {
    await ack();
    if (!isAdmin("slack", command.user_id)) {
      await respond({ response_type: "ephemeral", text: "Admins only." });
      return;
    }
    const [sub, rawId] = (command.text || "").trim().split(/\s+/);
    const userId = (rawId || "").replace(/[<@>]/g, "");
    if (sub === "allow" && userId) {
      grant("slack", userId);
      await respond({ response_type: "ephemeral", text: `Granted Minute to <@${userId}>.` });
      return;
    }
    if (sub === "revoke" && userId) {
      revoke("slack", userId);
      await respond({ response_type: "ephemeral", text: `Revoked Minute from <@${userId}>.` });
      return;
    }
    const cfg = loadConfig();
    const people = (ids: string[] | undefined) => (ids && ids.length ? ids.map((id) => `<@${id}>`).join(" ") : "(none)");
    const playgrounds = cfg.playgrounds
      .map((p) => `• ${p.id} → ${repoLabel(p)} · slack ${(p.slackChannelIds || []).join(", ") || "(none)"}`)
      .join("\n");
    await respond({
      response_type: "ephemeral",
      text: [
        `Requesters: ${people(listGranted("slack"))}`,
        `Tech: ${people(cfg.tech.slackUserIds)}`,
        playgrounds,
      ].join("\n"),
    });
  });

  app.action(/^pick_/, async ({ ack, body, action, client }) => {
    await ack();
    const actionId = "action_id" in action ? String(action.action_id) : "";
    const kind: Kind = actionId.endsWith("scratch") ? "scratch" : actionId.endsWith("ask") ? "ask" : "tweak";
    const trigger = "trigger_id" in body ? body.trigger_id : "";
    const channel = body.channel && "id" in body.channel ? body.channel.id : "";
    if (!trigger || !channel) return;
    await client.views.open({ trigger_id: trigger, view: requestModal(kind, channel) });
  });

  app.action(/^m\d+$/, async ({ ack, body, action, client }) => {
    await ack();
    const value = "value" in action ? String(action.value || "") : "";
    const userId = body.user.id;
    const channel = body.channel && "id" in body.channel ? body.channel.id : "";
    const message = "message" in body ? body.message : undefined;
    const thread = message && "thread_ts" in message ? message.thread_ts || message.ts : message?.ts;
    const err = handleSignedAction({ customId: value, userId });
    if (err && channel) {
      await client.chat.postMessage({ channel, thread_ts: thread, text: err });
    }
  });

  app.view("minute_start", async ({ ack, view, body, client }) => {
    const meta = JSON.parse(view.private_metadata || "{}") as { kind?: Kind; channel?: string };
    const text = view.state.values.request?.text?.value || "";
    const userId = body.user.id;
    await ack();
    if (!meta.channel) return;
    const userName = await displayName(client, userId, body.user.name);
    const err = await startMinute({
      client,
      userId,
      userName,
      channelId: meta.channel,
      text,
      kind: meta.kind,
    });
    if (err) {
      await client.chat.postEphemeral({ channel: meta.channel, user: userId, text: err });
    }
  });

  app.event("app_mention", async ({ event, client }) => {
    try {
      if (event.thread_ts || !event.user) return;
      const files = await slackFiles("files" in event ? (event.files as SlackFile[] | undefined) : undefined, event.ts);
      const text = mentionBody(event.text || "", slackStatus.botUserId);
      const userName = await displayName(client, event.user);
      const err = await startMinute({
        client,
        userId: event.user,
        userName,
        channelId: event.channel,
        text,
        files,
        replyTo: event.ts,
      });
      if (err) await client.chat.postMessage({ channel: event.channel, thread_ts: event.ts, text: err });
    } catch (err) {
      log.error({ err }, "slack mention");
    }
  });

  app.event("message", async ({ event, client }) => {
    try {
      if (!("user" in event) || !event.user || !("text" in event)) return;
      if ("bot_id" in event && event.bot_id) return;
      if (event.user === slackStatus.botUserId) return;
      const subtype = "subtype" in event ? event.subtype : undefined;
      if (subtype && subtype !== "file_share") return;
      const threadTs = "thread_ts" in event ? event.thread_ts : undefined;
      if (!threadTs || !("channel" in event)) return;
      const files = await slackFiles("files" in event ? (event.files as SlackFile[] | undefined) : undefined, event.ts);
      await onThreadReply(client, {
        channel: event.channel,
        threadTs,
        userId: event.user,
        text: event.text || "",
        files,
      });
    } catch (err) {
      log.error({ err }, "slack message");
    }
  });

  app.error(async (err) => {
    log.error({ err }, "slack");
  });

  await app.start();
  const auth = await app.client.auth.test();
  slackStatus.ready = true;
  slackStatus.userTag = auth.user || "";
  slackStatus.botUserId = auth.user_id || "";
  log.info({ user: slackStatus.userTag }, "slack connected");
  return { app, client: app.client, stop: () => app.stop() };
}

async function onThreadReply(
  client: WebClient,
  msg: { channel: string; threadTs: string; userId: string; text: string; files: Attachment[] },
) {
  if (busyRunInThread("slack", msg.threadTs)) {
    await client.chat.postMessage({ channel: msg.channel, thread_ts: msg.threadTs, text: busyAck() });
    return;
  }
  const run = runByThread("slack", msg.threadTs);
  if (!run || (run.status !== "proof" && run.status !== "classifying")) return;
  if (msg.userId !== run.requesterId && !isAdmin("slack", msg.userId)) return;

  const turn = parseTurn(msg.text, msg.files.length > 0);
  const admin = isAdmin("slack", msg.userId);
  const allowed = canActOnRun({ userId: msg.userId, requesterId: run.requesterId, isAdmin: admin });

  if (turn.kind === "handoff") {
    if (!allowed) {
      await client.chat.postMessage({ channel: msg.channel, thread_ts: msg.threadTs, text: "Only the requester can sign off." });
      return;
    }
    enqueueHandoff(run.id);
    return;
  }
  if (turn.kind === "cancel") {
    if (!allowed) {
      await client.chat.postMessage({ channel: msg.channel, thread_ts: msg.threadTs, text: "Only the requester can cancel." });
      return;
    }
    enqueueCancel(run.id, "Cancelled in chat. Minute is done.");
    return;
  }
  if (run.status !== "proof") return;
  if (msg.userId !== run.requesterId) return;
  if (!claimRun(run.id, "proof", "working")) return;
  if (!takeIterateToken("slack", msg.userId)) {
    claimRun(run.id, "working", "proof");
    await client.chat.postMessage({ channel: msg.channel, thread_ts: msg.threadTs, text: rateLimitedMessage() });
    return;
  }
  if (turn.kind === "need_attach_intent") {
    claimRun(run.id, "working", "proof");
    const live = getRun(run.id);
    if (live) {
      live.pendingAttachments = msg.files;
      saveRun(live);
    }
    await slackAdapter(client, { channel: msg.channel, threadTs: msg.threadTs }).askWithChips("What should I do with this?", [
      { customId: signButton("attach", run.id, "match"), label: "Match this" },
      { customId: signButton("attach", run.id, "spec"), label: "Read as spec" },
      { customId: signButton("attach", run.id, "asset"), label: "Put in the repo" },
    ]);
    return;
  }
  if (turn.kind === "undo") {
    enqueueUndo(run.id);
    return;
  }
  if (turn.kind === "mobile") {
    enqueueIterate(run.id, "show me mobile", msg.files);
    return;
  }
  if (turn.kind !== "tweak" || (!turn.text && msg.files.length === 0)) {
    claimRun(run.id, "working", "proof");
    return;
  }
  enqueueIterate(run.id, turn.text || "(see attached file)", msg.files);
}
