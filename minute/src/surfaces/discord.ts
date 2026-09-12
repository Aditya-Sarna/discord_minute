import { EmbedBuilder, type Message, type MessageCreateOptions, type TextBasedChannel } from "discord.js";
import type { ChatAdapter, Chip } from "./types.js";
import type { Proof, Run } from "../types.js";
import { splitAnswer } from "../ask.js";
import { clipChat } from "../turns.js";
import { log } from "../logger.js";
import {
  answerEmbed,
  askEmbed,
  chipRow,
  exitEmbed,
  handoffEmbed,
  MINUTE_GREEN,
  proofButtons,
  proofEmbed,
  proofFiles,
  refuseEmbed,
  statusEmbed,
} from "./discord-ui.js";

type Posted = { id: string };
type Editable = {
  edit: (payload: string | MessageCreateOptions) => Promise<unknown>;
  content?: string;
};

type Sendable = {
  send: (payload: string | MessageCreateOptions) => Promise<unknown>;
  messages?: { fetch: (id: string) => Promise<Editable> };
  sendTyping?: () => Promise<unknown>;
  setLocked?: (locked: boolean) => Promise<unknown>;
  setArchived?: (archived: boolean) => Promise<unknown>;
  client?: { user?: { displayAvatarURL: () => string } };
};

export function asSendable(channel: object): Sendable {
  if (!("send" in channel) || typeof (channel as Sendable).send !== "function") {
    throw new Error("channel cannot send");
  }
  return channel as Sendable;
}

function iconOf(channel: Sendable): string | undefined {
  try {
    return channel.client?.user?.displayAvatarURL();
  } catch {
    return undefined;
  }
}

export function discordAdapter(channel: Sendable): ChatAdapter {
  const iconURL = iconOf(channel);
  const send = (payload: string | MessageCreateOptions) => {
    if (typeof payload === "string") return channel.send(clipChat(payload));
    return channel.send({
      ...payload,
      content: payload.content ? clipChat(payload.content) : payload.content,
    });
  };

  return {
    mention: (userId) => `<@${userId}>`,

    async postOrUpdateStatus(text, messageId) {
      const payload = { embeds: [statusEmbed(text, iconURL)] };
      if (messageId && channel.messages) {
        try {
          const msg = await channel.messages.fetch(messageId);
          await msg.edit(payload);
          return messageId;
        } catch {
          // fall through to a new status card
        }
      }
      const posted = (await send(payload)) as Posted;
      return posted.id;
    },

    async postRefuse(reason) {
      await send({ embeds: [refuseEmbed(reason, iconURL)] });
    },

    async postAnswer(text, opts) {
      const chunks = splitAnswer(text);
      for (let i = 0; i < chunks.length; i++) {
        await send({
          embeds: [
            answerEmbed(chunks[i], {
              title: i === 0 ? opts?.title || "Answer" : "Answer (cont.)",
              footer: opts?.footer,
              iconURL,
            }),
          ],
        });
      }
    },

    async postProof(proof: Proof, run: Run) {
      if (run.lastProofMessageId) {
        await this.disableProofButtons(run.lastProofMessageId);
      }

      const files = proofFiles(proof);
      const payload: MessageCreateOptions = {
        embeds: [proofEmbed(proof, run, { iconURL })],
        files: files.length ? files : undefined,
        components: [proofButtons(run)],
      };
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const posted = (await send(payload)) as Posted;
          return posted.id;
        } catch (err) {
          lastErr = err;
          log.warn({ err, attempt }, "discord postProof retry");
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      throw lastErr;
    },

    async postHandoff(run, techMentions) {
      await send({
        embeds: [
          handoffEmbed({
            techMentions,
            requesterName: run.requesterName,
            summary: run.lastSummary,
            prUrl: run.prUrl,
            iconURL,
          }),
        ],
      });
    },

    async postExit(reason) {
      await send({ embeds: [exitEmbed(reason, iconURL)] });
    },

    async disableProofButtons(messageId) {
      if (!messageId || !channel.messages) return;
      try {
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ components: [] });
      } catch (err) {
        log.debug({ err, messageId }, "disableProofButtons");
      }
    },

    async stampSignedOff(messageId, line) {
      if (!messageId || !channel.messages) return;
      try {
        const msg = (await channel.messages.fetch(messageId)) as Editable & Message;
        const existing = msg.embeds?.[0];
        if (existing) {
          await msg.edit({
            content: null,
            components: [],
            embeds: [EmbedBuilder.from(existing).setColor(MINUTE_GREEN).setTitle("Signed off").setFooter({ text: line })],
          });
          return;
        }
        const prev = typeof msg.content === "string" ? msg.content : "";
        await msg.edit({ content: clipChat(`${prev}\n**${line}**`), components: [] });
      } catch (err) {
        log.debug({ err, messageId }, "stampSignedOff");
      }
    },

    async lockThread() {
      try {
        if (typeof channel.setLocked === "function") await channel.setLocked(true);
      } catch (err) {
        log.debug({ err }, "lockThread");
      }
    },

    async askWithChips(question, chips: Chip[]) {
      await send({
        embeds: [askEmbed(question, iconURL)],
        components: [chipRow(chips)],
      });
    },

    async setTyping() {
      try {
        if (typeof channel.sendTyping === "function") await channel.sendTyping();
      } catch {
        // ignore
      }
    },
  };
}

export function threadUrl(guildId: string | undefined, threadId: string): string | undefined {
  if (!guildId) return undefined;
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

export function isTextChannel(channel: unknown): channel is TextBasedChannel {
  return Boolean(channel && typeof channel === "object" && "isTextBased" in (channel as object));
}
