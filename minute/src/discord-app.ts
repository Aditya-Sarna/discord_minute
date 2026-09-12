import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
} from "discord.js";
import { isAdmin, isRequester, grant, revoke, denyMessage, listGranted } from "./access.js";
import { playgroundForChannel, loadConfig, repoLabel } from "./config.js";
import { getRun, runByThread, busyRunInThread, claimRun, saveRun } from "./store.js";
import { downloadAttachment } from "./download.js";
import { log } from "./logger.js";
import { clampRequest } from "./limits.js";
import { takeStartToken, takeIterateToken, rateLimitedMessage } from "./rate-limit.js";
import { createRunDraft } from "./protocol.js";
import { enqueueStart, enqueueIterate, enqueueHandoff, enqueueCancel, enqueueUndo } from "./jobs.js";
import { parseButton, signButton, canActOnRun } from "./buttons.js";
import { busyAck, mentionBody, needsRouteClarify, parseTurn } from "./turns.js";
import { inferAttachRole, refusedNames, withinAttachLimits } from "./attachments.js";
import { discordAdapter, asSendable, threadUrl } from "./surfaces/discord.js";
import { adminEmbed, askModal, kickoffEmbed, pickEmbed, pickRow, repoAskModal, scratchModal, threadTitle } from "./surfaces/discord-ui.js";
import { inferRunKind, MODAL_ASK, PICK_ASK } from "./ask.js";
import { MODAL_SCRATCH, PICK_SCRATCH, PICK_TWEAK } from "./scratch.js";
import { slashCommandsJson } from "./discord-commands.js";
import type { Attachment } from "./types.js";

export const discordStatus = {
  ready: false,
  userTag: "",
  messageContent: false,
};

async function gatherSlashFiles(interaction: ChatInputCommandInteraction, runKey: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const name of ["file", "file2", "file3"] as const) {
    const file = interaction.options.getAttachment(name);
    if (!file) continue;
    out.push(await downloadAttachment(runKey, { name: file.name, url: file.url, contentType: file.contentType ?? undefined }));
  }
  return out;
}

async function gatherMessageFiles(message: Message, runKey: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const att of message.attachments.values()) {
    out.push(await downloadAttachment(runKey, { name: att.name, url: att.url, contentType: att.contentType ?? undefined }));
  }
  return out;
}

async function beginRun(opts: {
  userId: string;
  userName: string;
  channelId: string;
  guildId: string | undefined;
  text: string;
  files: Attachment[];
  kind?: "tweak" | "scratch" | "ask";
  scratchName?: string;
  startThread: () => Promise<{ threadId: string; parentId: string; sendable: object }>;
}): Promise<string | undefined> {
  const playground = playgroundForChannel("discord", opts.channelId);
  if (!playground) {
    return "This channel isn’t wired to a playground. Ask an admin to add its channel ID.";
  }
  const bad = refusedNames(opts.files.map((f) => f.name));
  if (bad.length) {
    return `I can’t use ${bad.join(", ")}. Drop an image, PDF, doc, or a logo.`;
  }
  const limit = withinAttachLimits(opts.files);
  if (limit) return limit;

  const text = clampRequest(opts.text);
  if (!text && !opts.files.length) {
    return "Say what you want, or drop a mock / doc / logo.";
  }
  if (!text && opts.files.length && inferAttachRole("", opts.files.map((f) => f.name)) === "need_intent") {
    // still start — chips after thread
  }

  const kind = inferRunKind(text, playground, opts.kind);
  const started = await opts.startThread();
  const run = createRunDraft({
    surface: "discord",
    channelId: opts.channelId,
    threadId: started.threadId,
    parentMessageId: started.parentId,
    requesterId: opts.userId,
    requesterName: opts.userName,
    playgroundId: playground.id,
    text: text || "(see attached file)",
    guildId: opts.guildId,
    threadUrl: threadUrl(opts.guildId, started.threadId),
    kind,
    scratchName: opts.scratchName,
  });
  run.pendingAttachments = opts.files;
  saveRun(run);

  const adapter = discordAdapter(asSendable(started.sendable));
  const routes = playground.allow.routes.filter(Boolean);
  if (kind === "tweak" && text && needsRouteClarify(text, routes.length ? routes : playground.allow.routes)) {
    await adapter.askWithChips(
      "Homepage only, or the whole app?",
      (routes.length ? routes : ["/", "everywhere"]).slice(0, 5).map((r) => ({
        customId: signButton("route", run.id, encodeURIComponent(r)),
        label: r === "/" || r === "everywhere" ? (r === "/" ? "Homepage" : "Everywhere") : r.replace(/^\//, ""),
      })),
    );
    return;
  }

  if (!text && opts.files.length) {
    await adapter.askWithChips("What should I do with this?", [
      { customId: signButton("attach", run.id, "match"), label: "Match this" },
      { customId: signButton("attach", run.id, "spec"), label: "Read as spec" },
      { customId: signButton("attach", run.id, "asset"), label: "Put in the repo" },
    ]);
    return;
  }

  enqueueStart(run.id, opts.files);
  return undefined;
}

async function launchFromInteraction(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  text: string,
  files: Attachment[],
  opts?: { kind?: "tweak" | "scratch" | "ask"; scratchName?: string },
): Promise<string | undefined> {
  const playground = playgroundForChannel("discord", interaction.channelId ?? "");
  const kind = inferRunKind(text, playground, opts?.kind);
  const ask = text || (files[0]?.name ? `dropped ${files[0].name}` : "new Minute");
  const iconURL = interaction.client.user?.displayAvatarURL();
  await interaction.reply({
    embeds: [kickoffEmbed({ ask, requesterTag: `${interaction.user}`, iconURL, kind })],
  });
  const reply = await interaction.fetchReply();
  const channel = await interaction.channel?.fetch();
  if (!channel || !("threads" in channel)) {
    return "Minute needs a channel that can have threads.";
  }
  return beginRun({
    userId: interaction.user.id,
    userName: interaction.user.displayName || interaction.user.username || "someone",
    channelId: channel.id,
    guildId: interaction.guildId ?? undefined,
    text,
    files,
    kind,
    scratchName: opts?.scratchName,
    startThread: async () => {
      const thread = await reply.startThread({
        name: threadTitle(text || files[0]?.name || "file", kind),
        autoArchiveDuration: 1440,
      });
      return { threadId: thread.id, parentId: reply.id, sendable: thread };
    },
  });
}

async function handleAskModal(interaction: ModalSubmitInteraction) {
  const scratch = interaction.customId === MODAL_SCRATCH;
  const repoAsk = interaction.customId === MODAL_ASK;
  if (interaction.customId !== "minute:modal:ask" && !scratch && !repoAsk) return;
  const userId = interaction.user.id;
  if (!isRequester("discord", userId)) {
    await interaction.reply({ content: denyMessage(), ephemeral: true });
    return;
  }
  if (!takeStartToken("discord", userId)) {
    await interaction.reply({ content: rateLimitedMessage(), ephemeral: true });
    return;
  }
  const text = repoAsk
    ? clampRequest(
        `${interaction.fields.getTextInputValue("link") || ""}\n${interaction.fields.getTextInputValue("question") || ""}`,
      )
    : clampRequest(interaction.fields.getTextInputValue("request") || "");
  const scratchName = scratch ? clampRequest(interaction.fields.getTextInputValue("name") || "") : "";
  const err = await launchFromInteraction(interaction, text, [], {
    kind: repoAsk ? "ask" : scratch ? "scratch" : "tweak",
    scratchName: scratchName || undefined,
  });
  if (err) await interaction.followUp({ content: err, ephemeral: true });
}

export function createDiscordClient(withMessageContent = true) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;

  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);

  const client = new Client({
    intents,
    partials: [Partials.Channel],
  });

  client.on(Events.Error, (err) => {
    log.error({ err }, "discord client error");
  });
  client.on(Events.ShardDisconnect, (event, id) => {
    discordStatus.ready = false;
    log.warn({ event, id }, "discord shard disconnect");
  });
  client.on(Events.ShardReconnecting, (id) => {
    log.warn({ id }, "discord shard reconnecting");
  });
  client.on(Events.ShardReady, () => {
    discordStatus.ready = true;
  });
  client.once(Events.ClientReady, async (c) => {
    discordStatus.ready = true;
    discordStatus.userTag = c.user.tag;
    discordStatus.messageContent = c.options.intents.has(GatewayIntentBits.MessageContent);
    c.user.setPresence({
      status: "online",
      activities: [{ name: "the playground", type: ActivityType.Watching }],
    });
    log.info(
      { user: c.user.tag, messageContent: discordStatus.messageContent },
      "discord ready",
    );
    if (!discordStatus.messageContent) {
      log.warn("Message Content Intent is off — thread replies will not work");
    }
    const body = slashCommandsJson();
    for (const guild of c.guilds.cache.values()) {
      try {
        await guild.commands.set(body);
      } catch (err) {
        log.warn({ err, guild: guild.id }, "guild command register failed");
      }
    }
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (clientId) {
      try {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest.put(Routes.applicationCommands(clientId), { body });
      } catch (err) {
        log.warn({ err }, "global command register failed");
      }
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }
      if (interaction.isModalSubmit()) {
        await handleAskModal(interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "minute-admin") {
        await handleAdmin(interaction);
        return;
      }
      if (interaction.commandName !== "minute") return;

      const userId = interaction.user.id;
      if (!isRequester("discord", userId)) {
        await interaction.reply({ content: denyMessage(), ephemeral: true });
        return;
      }
      const text = clampRequest(interaction.options.getString("request") || "");
      const kindOpt = interaction.options.getString("kind");
      const kind =
        kindOpt === "scratch" ? "scratch" : kindOpt === "ask" ? "ask" : kindOpt === "tweak" ? "tweak" : undefined;
      const hasFile = Boolean(
        interaction.options.getAttachment("file") ||
          interaction.options.getAttachment("file2") ||
          interaction.options.getAttachment("file3"),
      );
      if (!text && !hasFile) {
        if (kind === "scratch") {
          await interaction.showModal(scratchModal());
          return;
        }
        if (kind === "tweak") {
          await interaction.showModal(askModal());
          return;
        }
        if (kind === "ask") {
          await interaction.showModal(repoAskModal());
          return;
        }
        await interaction.reply({
          ephemeral: true,
          embeds: [pickEmbed(interaction.client.user?.displayAvatarURL())],
          components: [pickRow()],
        });
        return;
      }
      if (!takeStartToken("discord", userId)) {
        await interaction.reply({ content: rateLimitedMessage(), ephemeral: true });
        return;
      }
      const files = await gatherSlashFiles(interaction, interaction.id);
      const err = await launchFromInteraction(interaction, text, files, { kind });
      if (err) {
        await interaction.followUp({ content: err, ephemeral: true });
      }
    } catch (err) {
      log.error({ err }, "discord interaction");
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Something went wrong. Try again.", ephemeral: true });
        }
      } catch {
        // already responded
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) return;
      if (client.user && !message.channel.isThread() && message.mentions.has(client.user)) {
        await handleMention(message);
        return;
      }
      if (!message.channel.isThread()) return;
      const threadId = message.channel.id;
      if (busyRunInThread("discord", threadId)) {
        await message.reply(busyAck());
        return;
      }
      const run = runByThread("discord", threadId);
      if (!run || (run.status !== "proof" && run.status !== "classifying")) return;
      if (message.author.id !== run.requesterId && !isAdmin("discord", message.author.id)) return;

      const files = await gatherMessageFiles(message, run.id);
      const turn = parseTurn(message.content, files.length > 0);

      if (turn.kind === "handoff") {
        if (!canActOnRun({ userId: message.author.id, requesterId: run.requesterId, isAdmin: isAdmin("discord", message.author.id) })) {
          await message.reply({ content: "Only the requester can sign off." });
          return;
        }
        enqueueHandoff(run.id);
        return;
      }
      if (turn.kind === "cancel") {
        if (!canActOnRun({ userId: message.author.id, requesterId: run.requesterId, isAdmin: isAdmin("discord", message.author.id) })) {
          await message.reply({ content: "Only the requester can cancel." });
          return;
        }
        enqueueCancel(run.id, "Cancelled in chat. Minute is done.");
        return;
      }

      if (run.status !== "proof") return;
      if (message.author.id !== run.requesterId) return;
      if (!claimRun(run.id, "proof", "working")) return;
      if (!takeIterateToken("discord", message.author.id)) {
        claimRun(run.id, "working", "proof");
        await message.reply(rateLimitedMessage());
        return;
      }

      if (turn.kind === "need_attach_intent") {
        claimRun(run.id, "working", "proof");
        const live = getRun(run.id);
        if (live) {
          live.pendingAttachments = files;
          saveRun(live);
        }
        const adapter = discordAdapter(asSendable(message.channel));
        await adapter.askWithChips("What should I do with this?", [
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
        enqueueIterate(run.id, "show me mobile", files);
        return;
      }
      if (turn.kind !== "tweak") {
        claimRun(run.id, "working", "proof");
        return;
      }
      if (!turn.text && files.length === 0) {
        claimRun(run.id, "working", "proof");
        return;
      }
      enqueueIterate(run.id, turn.text || "(see attached file)", files);
    } catch (err) {
      log.error({ err }, "discord message");
    }
  });

  return { client, token };
}

function isDisallowedIntents(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /disallowed intents/i.test(msg);
}

/** Login with Message Content if allowed; otherwise fall back so /minute still works. */
export async function connectDiscord() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  const first = createDiscordClient(true);
  if (!first) return null;
  try {
    await first.client.login(token);
    return first;
  } catch (err) {
    if (!isDisallowedIntents(err)) throw err;
    log.warn(
      "Message Content Intent is off in the Developer Portal. Logging in without it. /minute and buttons work; replies and @mentions will not until you enable it.",
    );
    first.client.destroy();
    const fallback = createDiscordClient(false);
    if (!fallback) return null;
    await fallback.client.login(token);
    return fallback;
  }
}

async function handleMention(message: Message) {
  const userId = message.author.id;
  if (!isRequester("discord", userId)) {
    await message.reply({ content: denyMessage() });
    return;
  }
  if (!takeStartToken("discord", userId)) {
    await message.reply({ content: rateLimitedMessage() });
    return;
  }
  const text = mentionBody(message.content, message.client.user?.id);
  const files = await gatherMessageFiles(message, message.id);
  const channel = message.channel;
  if (!("threads" in channel)) {
    await message.reply("Minute needs a channel that can have threads.");
    return;
  }
  const playground = playgroundForChannel("discord", message.channelId);
  const kind = inferRunKind(text, playground);
  const err = await beginRun({
    userId,
    userName: message.author.displayName || message.author.username,
    channelId: message.channelId,
    guildId: message.guildId ?? undefined,
    text,
    files,
    kind,
    startThread: async () => {
      const ack = await message.reply({
        embeds: [
          kickoffEmbed({
            ask: text || (files[0]?.name ? `dropped ${files[0].name}` : "new Minute"),
            requesterTag: `${message.author}`,
            iconURL: message.client.user?.displayAvatarURL(),
            kind,
          }),
        ],
      });
      const thread = await ack.startThread({
        name: threadTitle(text || files[0]?.name || "file", kind),
        autoArchiveDuration: 1440,
      });
      return { threadId: thread.id, parentId: ack.id, sendable: thread };
    },
  });
  if (err) await message.reply({ content: err });
}

async function handleButton(interaction: ButtonInteraction) {
  if (interaction.customId === PICK_TWEAK || interaction.customId === PICK_SCRATCH || interaction.customId === PICK_ASK) {
    if (!isRequester("discord", interaction.user.id)) {
      await interaction.reply({ content: denyMessage(), ephemeral: true });
      return;
    }
    await interaction.showModal(
      interaction.customId === PICK_SCRATCH
        ? scratchModal()
        : interaction.customId === PICK_ASK
          ? repoAskModal()
          : askModal(),
    );
    return;
  }
  const parsed = parseButton(interaction.customId);
  if (!parsed) {
    // legacy unsigned ids minute:action:runId
    const [prefix, action, runId] = interaction.customId.split(":");
    if (prefix !== "minute" || !runId) return;
    return handleParsedButton(interaction, { action, runId, extra: "" });
  }
  return handleParsedButton(interaction, parsed);
}

async function handleParsedButton(interaction: ButtonInteraction, parsed: { action: string; runId: string; extra: string }) {
  const run = getRun(parsed.runId);
  if (!run) {
    await interaction.reply({ content: "That Minute is gone.", ephemeral: true });
    return;
  }
  const admin = isAdmin("discord", interaction.user.id);
  const allowed = canActOnRun({ userId: interaction.user.id, requesterId: run.requesterId, isAdmin: admin });

  if (parsed.action === "looks_good") {
    if (!allowed) {
      await interaction.reply({ content: "Only the requester can sign off.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    enqueueHandoff(run.id);
    return;
  }
  if (parsed.action === "undo") {
    if (!allowed) {
      await interaction.reply({ content: "Only the requester can undo.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    enqueueUndo(run.id);
    return;
  }
  if (parsed.action === "cancel") {
    if (!allowed) {
      await interaction.reply({ content: "Only the requester can cancel.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    enqueueCancel(run.id, "Cancelled in chat. Minute is done.");
    return;
  }
  if (parsed.action === "route") {
    if (interaction.user.id !== run.requesterId && !admin) {
      await interaction.reply({ content: "Only the requester can pick.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const route = decodeURIComponent(parsed.extra || "/");
    run.request = `${run.originalAsk || run.request} (on ${route})`;
    saveRun(run);
    enqueueStart(run.id, run.pendingAttachments || []);
    return;
  }
  if (parsed.action === "attach") {
    if (interaction.user.id !== run.requesterId && !admin) {
      await interaction.reply({ content: "Only the requester can pick.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const role = parsed.extra as "match" | "spec" | "asset";
    const files = (run.pendingAttachments || []).map((f) => ({ ...f, role }));
    run.pendingAttachments = files;
    saveRun(run);
    const phrase =
      role === "match" ? "match this" : role === "spec" ? "read this as spec" : "put this in the repo";
    if (run.status === "classifying" && !run.prNumber) {
      run.request = run.originalAsk && run.originalAsk !== "(see attached file)" ? `${run.originalAsk} — ${phrase}` : phrase;
      saveRun(run);
      enqueueStart(run.id, files);
      return;
    }
    enqueueIterate(run.id, phrase, files);
  }
}

async function handleAdmin(interaction: ChatInputCommandInteraction) {
  if (!isAdmin("discord", interaction.user.id)) {
    await interaction.reply({ content: "Admins only.", ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser("user");
  if (sub === "allow" && user) {
    grant("discord", user.id);
    await interaction.reply({ content: `Granted Minute to ${user}.`, ephemeral: true });
    return;
  }
  if (sub === "revoke" && user) {
    revoke("discord", user.id);
    await interaction.reply({ content: `Revoked Minute from ${user}.`, ephemeral: true });
    return;
  }
  const cfg = loadConfig();
  const playgrounds = cfg.playgrounds
    .map((p) => `• ${p.id} → ${repoLabel(p)} · discord ${p.discordChannelIds.join(", ") || "(none)"}`)
    .join("\n");
  await interaction.reply({
    ephemeral: true,
    embeds: [
      adminEmbed(
        [
          `Requesters: ${listGranted("discord").map((id) => `<@${id}>`).join(" ") || "(none)"}`,
          `Tech: ${cfg.tech.discordUserIds.map((id) => `<@${id}>`).join(" ") || "(none)"}`,
          playgrounds,
        ],
        interaction.client.user?.displayAvatarURL(),
      ),
    ],
  });
}
