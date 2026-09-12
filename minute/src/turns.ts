/** Conversation turns in a Minute thread — English, not a command manual. */

export type Turn =
  | { kind: "handoff" }
  | { kind: "cancel" }
  | { kind: "undo" }
  | { kind: "mobile" }
  | { kind: "need_attach_intent" }
  | { kind: "tweak"; text: string };

const HANDOFF = /^(looks good|lgtm|ship it|that(?:'s| is) it|perfect|done)\.?$/i;
const CANCEL = /^(cancel|stop|nevermind|never mind|forget it|abort)\.?$/i;
const UNDO = /^(undo( that)?|revert( that)?|go back|put it back)\.?$/i;
const MOBILE = /^(show me )?(mobile|phone)( (view|photo|shot|frame))?\??\.?$/i;

export function parseTurn(raw: string, hasAttachments: boolean): Turn {
  const text = raw.replace(/\0/g, "").trim();
  if (HANDOFF.test(text)) return { kind: "handoff" };
  if (CANCEL.test(text)) return { kind: "cancel" };
  if (UNDO.test(text)) return { kind: "undo" };
  if (MOBILE.test(text)) return { kind: "mobile" };
  if (!text && hasAttachments) return { kind: "need_attach_intent" };
  if (!text && !hasAttachments) return { kind: "tweak", text: "" };
  return { kind: "tweak", text };
}

export function mentionBody(content: string, botId?: string): string {
  let text = content;
  if (botId) text = text.replace(new RegExp(`<@!?${botId}>`, "g"), "");
  return text.replace(/\0/g, "").trim();
}

export function needsRouteClarify(request: string, routes: string[]): boolean {
  if (routes.length < 2) return false;
  const lower = request.toLowerCase();
  return !routes.some((r) => {
    const token = r.replace(/^\//, "").toLowerCase();
    if (!token) {
      return /\b(home|homepage|landing|index|\/)\b/.test(lower);
    }
    return lower.includes(token) || lower.includes(r.toLowerCase());
  });
}

export function busyAck(): string {
  return "Still working — I’ll take that next.";
}

export function spokenProofCaption(opts: {
  summary: string;
  using?: string[];
  skippedReason?: string;
  tweaksLeft?: number;
  tweaksMax?: number;
}): string {
  const using = opts.using?.length ? ` Using ${opts.using.join(", ")}.` : "";
  const budget =
    opts.tweaksLeft != null && opts.tweaksMax != null
      ? ` ${opts.tweaksLeft} of ${opts.tweaksMax} tweaks left.`
      : "";
  if (opts.skippedReason) {
    return clipChat(`${opts.summary.replace(/\.*$/, "")}.${using} ${opts.skippedReason}${budget}`.trim());
  }
  return clipChat(
    `${opts.summary.replace(/\.*$/, "")}.${using} Darker, or is this it?${budget}`.replace(/\s+/g, " ").trim(),
  );
}

export const DISCORD_CONTENT_MAX = 1900;

export function clipChat(text: string, max = DISCORD_CONTENT_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}
