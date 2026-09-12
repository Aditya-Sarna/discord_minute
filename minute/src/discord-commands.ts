import { SlashCommandBuilder } from "discord.js";

export function slashCommandsJson() {
  return [
    new SlashCommandBuilder()
      .setName("minute")
      .setDescription("Minute — tweak the playground, start a project, or ask about a GitHub repo.")
      .addStringOption((o) =>
        o.setName("request").setDescription("What you want (or skip this and a form opens)").setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName("kind")
          .setDescription("Change the playground, create a repo, or ask about code")
          .addChoices(
            { name: "Change the playground", value: "tweak" },
            { name: "Start a new project", value: "scratch" },
            { name: "Ask about a repo", value: "ask" },
          ),
      )
      .addAttachmentOption((o) => o.setName("file").setDescription("Image, doc, or asset"))
      .addAttachmentOption((o) => o.setName("file2").setDescription("Another file"))
      .addAttachmentOption((o) => o.setName("file3").setDescription("Another file")),
    new SlashCommandBuilder()
      .setName("minute-admin")
      .setDescription("Grant Minute access (admins only)")
      .addSubcommand((s) =>
        s
          .setName("allow")
          .setDescription("Let this person run Minute")
          .addUserOption((o) => o.setName("user").setDescription("Person").setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName("revoke")
          .setDescription("Remove Minute access")
          .addUserOption((o) => o.setName("user").setDescription("Person").setRequired(true)),
      )
      .addSubcommand((s) => s.setName("who").setDescription("Show requesters, tech, playgrounds")),
  ].map((c) => c.toJSON());
}
