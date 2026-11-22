import { createReadStream, existsSync } from "node:fs";
import type { WebClient } from "@slack/web-api";
import type { ChatAdapter, Chip } from "./types.js";
import type { Proof, Run } from "../types.js";
import { splitAnswer } from "../ask.js";
import { LIMITS } from "../limits.js";
import { clipChat, spokenProofCaption } from "../turns.js";
import { signButton } from "../buttons.js";
import { log } from "../logger.js";

type Button = {
  type: "button";
  text: { type: "plain_text"; text: string };
  action_id: string;
  value?: string;
  url?: string;
  style?: "primary" | "danger";
};

function buttons(items: { label: string; value?: string; url?: string; style?: "primary" | "danger" }[]): unknown[] {
  const elements: Button[] = items.slice(0, 5).map((item, i) => {
    const button: Button = {
      type: "button",
      text: { type: "plain_text", text: item.label.slice(0, 75) },
      action_id: item.url ? `link_${i}` : `m${i}`,
    };
    if (item.url) button.url = item.url;
    else button.value = item.value || item.label;
    if (item.style) button.style = item.style;
    return button;
  });
  return [{ type: "actions", block_id: "minute", elements }];
}

function proofLine(proof: Proof, run: Run): string {
  const used = run.iterationCount ?? 0;
  const left = Math.max(0, LIMITS.iterations - used);
  const caption = spokenProofCaption({
    summary: proof.caption,
    using: proof.using,
    skippedReason: proof.skippedReason,
    tweaksLeft: left,
    tweaksMax: LIMITS.iterations,
  });
  const route = proof.route ? (proof.route.startsWith("/") ? proof.route : `/${proof.route}`) : "";
  const files = proof.filesChanged.filter((f) => !f.startsWith(".minute/")).slice(0, 6);
  const bits = [caption];
  if (route) bits.push(`Page \`${route}\``);
  if (files.length) bits.push(files.map((f) => `\`${f}\``).join(", "));
  return clipChat(bits.join("\n"));
}

export function slackAdapter(
  client: WebClient,
  opts: { channel: string; threadTs: string; statusTs?: string },
): ChatAdapter {
  const { channel, threadTs } = opts;
  const statusTs = opts.statusTs || threadTs;

  async function say(text: string, extra?: { blocks?: unknown[]; thread?: boolean }): Promise<string | undefined> {
    const posted = await client.chat.postMessage({
      channel,
      text: clipChat(text),
      thread_ts: extra?.thread === false ? undefined : threadTs,
      blocks: extra?.blocks as never,
    });
    return posted.ts;
  }

  async function edit(ts: string, text: string, blocks?: unknown[]) {
    await client.chat.update({
      channel,
      ts,
      text: clipChat(text),
      blocks: (blocks ?? []) as never,
    });
  }

  return {
    mention: (userId) => `<@${userId}>`,

    async postOrUpdateStatus(text, messageId) {
      const ts = messageId || statusTs;
      try {
        await edit(ts, text);
        return ts;
      } catch (err) {
        log.warn({ err }, "slack status update failed");
        return say(text);
      }
    },

    async postRefuse(reason) {
      await say(reason);
    },

    async postAnswer(text, opts) {
      const title = opts?.title ? `*${opts.title}*\n` : "";
      const footer = opts?.footer ? `\n_${opts.footer}_` : "";
      const chunks = splitAnswer(`${title}${text}${footer}`, 2800);
      for (const chunk of chunks) await say(chunk);
    },

    async postProof(proof, run) {
      const shots = [proof.afterPath, proof.phonePath, proof.beforePath].filter(
        (p): p is string => Boolean(p && existsSync(p)),
      );
      for (const path of shots) {
        const filename = path === proof.phonePath ? "after-phone.png" : path === proof.beforePath ? "before.png" : "after.png";
        try {
          await client.files.uploadV2({
            channel_id: channel,
            thread_ts: threadTs,
            file: createReadStream(path),
            filename,
          });
        } catch (err) {
          log.warn({ err, filename }, "slack photo upload failed");
        }
      }
      const line = proofLine(proof, run);
      const actions = buttons([
        { label: "Looks good", value: signButton("looks_good", run.id), style: "primary" },
        { label: "Undo", value: signButton("undo", run.id) },
        { label: "Cancel", value: signButton("cancel", run.id), style: "danger" },
        ...(run.prUrl ? [{ label: "Open PR", url: run.prUrl }] : []),
      ]);
      return say(line, { blocks: [{ type: "section", text: { type: "mrkdwn", text: line } }, ...actions] });
    },

    async postHandoff(run, techMentions) {
      const what = run.lastSummary || run.originalAsk || run.request;
      const pr = run.prUrl ? `\n${run.prUrl}` : "";
      await say(`${techMentions}\n*${run.requesterName || "The requester"}* signed off.\n${what}${pr}`);
    },

    async postExit(reason) {
      await say(reason);
    },

    async disableProofButtons(messageId) {
      if (!messageId) return;
      try {
        await edit(messageId, "Photo is above.");
      } catch (err) {
        log.warn({ err }, "slack disable buttons failed");
      }
    },

    async stampSignedOff(messageId, line) {
      if (!messageId) return;
      try {
        await edit(messageId, line);
      } catch (err) {
        log.warn({ err }, "slack stamp failed");
        await say(line);
      }
    },

    async lockThread() {
      // Slack threads stay open. The run status is what stops further work.
    },

    async askWithChips(question, chips: Chip[]) {
      const line = clipChat(question);
      await say(line, {
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: line } },
          ...buttons(chips.map((c, i) => ({ label: c.label, value: c.customId, style: i === 0 ? "primary" as const : undefined }))),
        ],
      });
    },

    async setTyping() {
      // Slack has no thread typing indicator for bots.
    },
  };
}
