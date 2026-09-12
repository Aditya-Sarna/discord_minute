import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.MINUTE_SIGNING_SECRET || process.env.DISCORD_TOKEN || "minute-dev-signing";
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 16);
}

export function signButton(action: string, runId: string, extra = "", ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = `${action}:${runId}:${extra}:${exp}`;
  return `minute:${action}:${runId}:${extra}:${exp}:${hmac(payload)}`;
}

export type ParsedButton = {
  action: string;
  runId: string;
  extra: string;
};

export function parseButton(customId: string): ParsedButton | undefined {
  const parts = customId.split(":");
  if (parts[0] !== "minute" || parts.length < 6) return undefined;
  const action = parts[1];
  const runId = parts[2];
  const extra = parts[3];
  const exp = Number(parts[4]);
  const sig = parts[5];
  if (!action || !runId || !Number.isFinite(exp) || !sig) return undefined;
  if (Date.now() > exp) return undefined;
  const payload = `${action}:${runId}:${extra}:${exp}`;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return { action, runId, extra };
}

export function canActOnRun(opts: {
  userId: string;
  requesterId: string;
  isAdmin: boolean;
}): boolean {
  return opts.userId === opts.requesterId || opts.isAdmin;
}
