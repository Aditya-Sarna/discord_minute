import { existsSync } from "node:fs";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { signButton } from "../buttons.js";
import { spokenProofCaption, clipChat } from "../turns.js";
import { LIMITS } from "../limits.js";
import { MODAL_ASK, PICK_ASK, parseGithubUrl } from "../ask.js";
import { MODAL_SCRATCH, PICK_SCRATCH, PICK_TWEAK } from "../scratch.js";
import type { Chip } from "./types.js";
import type { Proof, Run } from "../types.js";

function liveFile(path?: string): string | undefined {
  return path && existsSync(path) ? path : undefined;
}

/** Brass minute-hand. Not Discord blurple — this is Minute's card. */
export const MINUTE_GOLD = 0xe8b931;
export const MINUTE_GREEN = 0x3ddc97;
export const MINUTE_RED = 0xe85d4c;
export const MINUTE_MUTED = 0x8b8680;

const FOOTER_WORK = "Reply in the thread to tweak";
const FOOTER_PROOF = "Reply to tweak · Looks good hands it to tech";

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function brand(embed: EmbedBuilder, iconURL?: string): EmbedBuilder {
  return embed.setAuthor({ name: "Minute", iconURL }).setTimestamp();
}

export function statusTitle(text: string): string {
  if (/taking the photo/i.test(text)) return "Taking the photo";
  if (/starting the app|installing|restoring packages/i.test(text)) return "Booting the app";
  if (/opening the pr/i.test(text)) return "Opening the PR";
  if (/creating a new github repo|creating a new repo/i.test(text)) return "Creating the repo";
  if (/building the first/i.test(text)) return "Building";
  if (/reading the repo|inspecting/i.test(text)) return "Reading the repo";
  if (/answering/i.test(text)) return "Answering";
  if (/cloning the new repo/i.test(text)) return "Cloning";
  if (/editing/i.test(text)) return "Editing";
  if (/cloning/i.test(text)) return "Cloning";
  if (/handed to tech|signed off/i.test(text)) return "Handed to tech";
  if (/merged/i.test(text)) return "Merged";
  return "Working";
}

export function kickoffEmbed(opts: {
  ask: string;
  requesterTag: string;
  iconURL?: string;
  kind?: "tweak" | "scratch" | "ask";
}): EmbedBuilder {
  const scratch = opts.kind === "scratch";
  const ask = opts.kind === "ask";
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_GOLD)
      .setTitle(ask ? "Reading the repo" : scratch ? "New project" : "On it")
      .setDescription(clip(`${opts.requesterTag}\n${opts.ask}`, 4096))
      .setFooter({
        text: ask
          ? "Minute reads the GitHub repo and answers in the thread. Reply to ask more."
          : scratch
            ? "Minute creates a GitHub repo. You look at the photo. Tech reviews the PR."
            : "Minute opens a thread. The photo is this branch, not staging.",
      }),
    opts.iconURL,
  );
}

export function statusEmbed(text: string, iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_GOLD)
      .setTitle(statusTitle(text))
      .setDescription(clip(text, 4096))
      .setFooter({ text: FOOTER_WORK }),
    iconURL,
  );
}

export function answerEmbed(text: string, opts?: { title?: string; footer?: string; iconURL?: string }): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_GOLD)
      .setTitle(opts?.title || "Answer")
      .setDescription(clip(text, 4096))
      .setFooter({ text: opts?.footer || "Reply in the thread to ask more" }),
    opts?.iconURL,
  );
}

export function refuseEmbed(reason: string, iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_RED)
      .setTitle("Can't do this one")
      .setDescription(clip(reason, 4096)),
    iconURL,
  );
}

export function exitEmbed(reason: string, iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_MUTED)
      .setTitle("Minute is done")
      .setDescription(clip(reason, 4096)),
    iconURL,
  );
}

export function askEmbed(question: string, iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder().setColor(MINUTE_GOLD).setTitle("Quick check").setDescription(clip(question, 4096)),
    iconURL,
  );
}

export function handoffEmbed(opts: {
  techMentions: string;
  requesterName: string;
  summary?: string;
  prUrl?: string;
  iconURL?: string;
}): EmbedBuilder {
  const what = opts.summary ? clip(opts.summary, 1024) : "Visual sign-off. Review the PR on technical grounds.";
  const embed = brand(
    new EmbedBuilder()
      .setColor(MINUTE_GREEN)
      .setTitle("Handed to tech")
      .setDescription(`${opts.techMentions}\n**${opts.requesterName}** signed off.\n${what}`),
    opts.iconURL,
  );
  if (opts.prUrl) embed.addFields({ name: "PR", value: opts.prUrl });
  return embed;
}

export function proofEmbed(
  proof: Proof,
  run: Run,
  opts?: { signedOff?: string; iconURL?: string },
): EmbedBuilder {
  const used = run.iterationCount ?? 0;
  const left = Math.max(0, LIMITS.iterations - used);
  const caption = spokenProofCaption({
    summary: proof.caption,
    using: proof.using,
    skippedReason: proof.skippedReason,
    tweaksLeft: left,
    tweaksMax: LIMITS.iterations,
  });
  const embed = brand(
    new EmbedBuilder()
      .setColor(opts?.signedOff ? MINUTE_GREEN : MINUTE_GOLD)
      .setTitle(opts?.signedOff ? "Signed off" : "Here's the photo")
      .setDescription(clip(opts?.signedOff ? `${caption}\n\n**${opts.signedOff}**` : caption, 4096))
      .setFooter({
        text: opts?.signedOff
          ? "Handed to tech"
          : `${left} of ${LIMITS.iterations} tweaks left · ${FOOTER_PROOF}`,
      }),
    opts?.iconURL,
  );

  const route = proof.route ? (proof.route.startsWith("/") ? proof.route : `/${proof.route}`) : "";
  const files = proof.filesChanged.filter((f) => !f.startsWith(".minute/")).slice(0, 6);
  embed.addFields({ name: "For", value: run.requesterName || "you", inline: true });
  if (run.scratchGithub) {
    embed.addFields({
      name: "Repo",
      value: `${run.scratchGithub.owner}/${run.scratchGithub.repo}`,
      inline: true,
    });
  }
  if (route) embed.addFields({ name: "Page", value: `\`${route}\``, inline: true });
  if (files.length) {
    embed.addFields({ name: "Changed", value: clip(files.map((f) => `\`${f}\``).join("\n"), 1024), inline: true });
  }
  if (liveFile(proof.afterPath)) embed.setImage("attachment://after.png");
  if (liveFile(proof.phonePath)) embed.setThumbnail("attachment://after-phone.png");
  return embed;
}

export function proofFiles(proof: Proof): { attachment: string; name: string }[] {
  const files: { attachment: string; name: string }[] = [];
  const after = liveFile(proof.afterPath);
  const phone = liveFile(proof.phonePath);
  const before = liveFile(proof.beforePath);
  if (after) files.push({ attachment: after, name: "after.png" });
  if (phone) files.push({ attachment: phone, name: "after-phone.png" });
  if (before) {
    files.push({
      attachment: before,
      name: before.toLowerCase().endsWith(".png") ? "SPOILER_before.png" : "SPOILER_before",
    });
  }
  return files;
}

export function proofButtons(run: Run): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(signButton("looks_good", run.id))
      .setLabel("Looks good")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(signButton("undo", run.id))
      .setLabel("Undo")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(signButton("cancel", run.id))
      .setLabel("Cancel")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Secondary),
    ...(run.prUrl
      ? [new ButtonBuilder().setLabel("Open PR").setStyle(ButtonStyle.Link).setURL(run.prUrl)]
      : []),
  );
}

export function chipRow(chips: Chip[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    chips.slice(0, 5).map((c, i) =>
      new ButtonBuilder()
        .setCustomId(c.customId)
        .setLabel(clipChat(c.label, 80))
        .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

export function repoAskModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_ASK)
    .setTitle("Ask about a repo")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("GitHub link")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder("https://github.com/owner/repo"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("question")
          .setLabel("Your question")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1800)
          .setPlaceholder("How is auth implemented? Where does checkout start?"),
      ),
    );
}

export function askModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("minute:modal:ask")
    .setTitle("Minute")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("request")
          .setLabel("What should change?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder("Make the header green…"),
      ),
    );
}

export function scratchModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_SCRATCH)
    .setTitle("New project")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("request")
          .setLabel("What are we building?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder("A notes page for my class…"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Repo name (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
          .setPlaceholder("class-notes"),
      ),
    );
}

export function pickEmbed(iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_GOLD)
      .setTitle("What kind of Minute?")
      .setDescription(
        "Change the playground, start a new GitHub repo, or paste a GitHub link and ask about the code.",
      ),
    iconURL,
  );
}

export function pickRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PICK_TWEAK).setLabel("Change the playground").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PICK_SCRATCH).setLabel("Start a new project").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PICK_ASK).setLabel("Ask about a repo").setStyle(ButtonStyle.Secondary),
  );
}

export function adminEmbed(lines: string[], iconURL?: string): EmbedBuilder {
  return brand(
    new EmbedBuilder()
      .setColor(MINUTE_GOLD)
      .setTitle("Minute admin")
      .setDescription(clip(lines.join("\n"), 4096)),
    iconURL,
  );
}

export function threadTitle(ask: string, kind?: "tweak" | "scratch" | "ask"): string {
  if (kind === "ask") {
    const gh = parseGithubUrl(ask);
    const label = gh ? `${gh.owner}/${gh.repo}` : clip(ask || "repo", 60);
    return clip(`Minute · ask · ${label}`, 100);
  }
  const label = clip(ask || "file", 80);
  return kind === "scratch" ? `Minute · new · ${label}` : `Minute · ${label}`;
}
