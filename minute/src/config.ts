import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { overlayScratchPlayground } from "./scratch.js";
import type { MinuteConfig, Playground, Run, Surface } from "./types.js";

const ids = z.array(z.string()).default([]);

const schema = z.object({
  minute: z.object({
    name: z.string().default("Office"),
    admins: z
      .object({
        discordUserIds: ids,
        githubLogins: ids,
      })
      .default({}),
    requesters: z
      .object({
        discordUserIds: ids,
      })
      .default({}),
    tech: z
      .object({
        discordUserIds: ids,
      })
      .default({}),
    playgrounds: z
      .array(
        z.object({
          id: z.string(),
          discordChannelIds: ids,
          github: z.object({
            owner: z.string(),
            repo: z.string(),
            defaultBranch: z.string().default("main"),
          }),
          preview: z
            .object({
              baseUrl: z.string().default(""),
              command: z.string().default(""),
              cwd: z.string().default(""),
              url: z.string().default("http://localhost:3000"),
              waitSeconds: z.number().default(45),
              defaultRoute: z.string().default("/"),
              install: z.boolean().default(true),
              installTimeoutSeconds: z.number().default(240),
            })
            .default({}),
          allow: z
            .object({
              paths: z.array(z.string()).default([]),
              routes: z.array(z.string()).default(["/"]),
            })
            .default({}),
          refuse: z.array(z.string()).default([]),
        }),
      )
      .min(1),
  }),
});

let cached: MinuteConfig | null = null;

export function configPath(): string {
  return resolve(process.env.MINUTE_CONFIG ?? "minute.config.yaml");
}

export function loadConfig(): MinuteConfig {
  if (cached) return cached;
  const raw = readFileSync(configPath(), "utf8");
  const parsed = schema.parse(parse(raw));
  cached = parsed.minute;
  return cached;
}

export function reloadConfig(): MinuteConfig {
  cached = null;
  return loadConfig();
}

export function playgroundForChannel(_surface: Surface, channelId: string): Playground | undefined {
  return loadConfig().playgrounds.find((p) => p.discordChannelIds.includes(channelId));
}

export function techIds(_surface: Surface): string[] {
  return loadConfig().tech.discordUserIds;
}

export function repoLabel(p: Playground): string {
  return `${p.github.owner}/${p.github.repo}`;
}

export function playgroundById(id: string): Playground | undefined {
  return loadConfig().playgrounds.find((p) => p.id === id);
}

/** Channel playground, overlaid with a scratch GitHub repo when this run created one. */
export function playgroundForRun(run: Run): Playground | undefined {
  const base =
    playgroundForChannel(run.surface, run.channelId) ?? playgroundById(run.playgroundId);
  if (!base) return undefined;
  if (run.kind === "scratch" && run.scratchGithub) {
    return overlayScratchPlayground(base, run.scratchGithub);
  }
  return base;
}
