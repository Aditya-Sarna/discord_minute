import "dotenv/config";
import { REST, Routes } from "discord.js";
import { slashCommandsJson } from "../src/discord-commands.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) {
  console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);
await rest.put(Routes.applicationCommands(clientId), { body: slashCommandsJson() });
console.log("Registered /minute and /minute-admin");
