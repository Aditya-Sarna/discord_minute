import { pino } from "pino";

export const log = pino({
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "GITHUB_TOKEN",
      "DISCORD_TOKEN",
      "MINUTE_SIGNING_SECRET",
      "MINUTE_INTERNAL_TOKEN",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "req.headers.authorization",
      "*.token",
      "*.password",
    ],
    censor: "***",
  },
});
