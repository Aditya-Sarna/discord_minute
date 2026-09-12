import { loadConfig, repoLabel } from "./config.js";
import { listGranted } from "./access.js";
import { inflightCount } from "./queue.js";
import { recentRuns } from "./store.js";
import { discordStatus } from "./discord-app.js";
import { llmConfigured } from "./llm.js";
import { githubWriteOk } from "./github.js";

export async function overviewPayload() {
  const cfg = loadConfig();
  const write = await githubWriteOk();
  return {
    up: true,
    name: cfg.name,
    githubConfigured: Boolean(process.env.GITHUB_TOKEN),
    githubWrite: write,
    llmConfigured: llmConfigured(),
    llmModel: process.env.MINUTE_LLM_MODEL || "qwen2.5-coder:7b",
    llmBackend: process.env.MINUTE_LLM_BACKEND || "ollama",
    intents: { messageContent: discordStatus.messageContent },
    discord: { userTag: discordStatus.userTag, ready: discordStatus.ready },
    surfaces: {
      discord: discordStatus.ready,
    },
    inflight: inflightCount(),
    admins: { discordUserIds: cfg.admins.discordUserIds },
    requesters: {
      discordUserIds: listGranted("discord"),
    },
    tech: { discordUserIds: cfg.tech.discordUserIds },
    playgrounds: cfg.playgrounds.map((p) => ({
      id: p.id,
      repo: repoLabel(p),
      defaultBranch: p.github.defaultBranch,
      livePreview: Boolean(p.preview.command),
      discordChannelIds: p.discordChannelIds,
      allowPaths: p.allow.paths,
    })),
  };
}

export function runsPayload() {
  return {
    runs: recentRuns(40).map((r) => ({
      id: r.id,
      status: r.status,
      requesterName: r.requesterName,
      request: r.originalAsk || r.request,
      surface: r.surface,
      lastSummary: r.lastSummary,
      prUrl: r.prUrl,
      prNumber: r.prNumber,
      updatedAt: r.updatedAt,
      proof: Boolean(r.lastProofPath),
    })),
  };
}
