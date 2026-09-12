import { playgroundForChannel } from "./config.js";
import { createRunDraft } from "./protocol.js";
import { enqueueStart, enqueueIterate, enqueueHandoff, enqueueCancel, enqueueUndo } from "./jobs.js";
import { getRun, saveRun } from "./store.js";
import { clampRequest } from "./limits.js";
import { parseButton, canActOnRun, signButton } from "./buttons.js";
import { isAdmin } from "./access.js";
import { needsRouteClarify } from "./turns.js";
import { inferAttachRole, refusedNames, withinAttachLimits } from "./attachments.js";
import type { ChatAdapter } from "./surfaces/types.js";
import { inferRunKind } from "./ask.js";
import type { Attachment, Surface } from "./types.js";

export async function beginSurfaceRun(opts: {
  surface: Surface;
  userId: string;
  userName: string;
  channelId: string;
  text: string;
  files?: Attachment[];
  guildId?: string;
  threadUrl?: (threadId: string) => string | undefined;
  skipChips?: boolean;
  openThread: () => Promise<{ threadId: string; parentId: string; chat: ChatAdapter }>;
}): Promise<string | undefined> {
  const playground = playgroundForChannel(opts.surface, opts.channelId);
  if (!playground) {
    return "This inbox isn’t wired to a Minute playground. Ask an admin to add it.";
  }
  const files = opts.files ?? [];
  const bad = refusedNames(files.map((f) => f.name));
  if (bad.length) return `I can’t use ${bad.join(", ")}. Drop an image, PDF, doc, or a logo.`;
  const limit = withinAttachLimits(files);
  if (limit) return limit;

  const text = clampRequest(opts.text);
  if (!text && !files.length) return "Say what you want, or drop a mock / doc / logo.";

  const started = await opts.openThread();
  const kind = inferRunKind(text, playground);
  const run = createRunDraft({
    surface: opts.surface,
    channelId: opts.channelId,
    threadId: started.threadId,
    parentMessageId: started.parentId,
    requesterId: opts.userId,
    requesterName: opts.userName,
    playgroundId: playground.id,
    text: text || "(see attached file)",
    guildId: opts.guildId,
    threadUrl: opts.threadUrl?.(started.threadId),
    kind,
  });
  run.pendingAttachments = files;
  saveRun(run);

  const chat = started.chat;
  if (!opts.skipChips && kind === "tweak") {
    const routes = playground.allow.routes.filter(Boolean);
    if (text && needsRouteClarify(text, routes.length ? routes : playground.allow.routes)) {
      await chat.askWithChips(
        "Homepage only, or the whole app?",
        (routes.length ? routes : ["/", "everywhere"]).slice(0, 5).map((r) => ({
          customId: signButton("route", run.id, encodeURIComponent(r)),
          label: r === "/" || r === "everywhere" ? (r === "/" ? "Homepage" : "Everywhere") : r.replace(/^\//, ""),
        })),
      );
      return;
    }

    if (!text && files.length && inferAttachRole("", files.map((f) => f.name)) === "need_intent") {
      await chat.askWithChips("What should I do with this?", [
        { customId: signButton("attach", run.id, "match"), label: "Match this" },
        { customId: signButton("attach", run.id, "spec"), label: "Read as spec" },
        { customId: signButton("attach", run.id, "asset"), label: "Put in the repo" },
      ]);
      return;
    }
  }

  enqueueStart(run.id, files);
  return undefined;
}

export function handleSignedAction(opts: { customId: string; userId: string }): string | undefined {
  const parsed = parseButton(opts.customId);
  if (!parsed) return "That control expired. Reply in the thread instead.";
  const run = getRun(parsed.runId);
  if (!run) return "That Minute is gone.";
  const admin = isAdmin(run.surface, opts.userId);
  const allowed = canActOnRun({ userId: opts.userId, requesterId: run.requesterId, isAdmin: admin });

  if (parsed.action === "looks_good") {
    if (!allowed) return "Only the requester can sign off.";
    enqueueHandoff(run.id);
    return;
  }
  if (parsed.action === "cancel") {
    if (!allowed) return "Only the requester can cancel.";
    enqueueCancel(run.id, "Cancelled in chat. Minute is done.");
    return;
  }
  if (parsed.action === "undo") {
    if (!allowed) return "Only the requester can undo.";
    enqueueUndo(run.id);
    return;
  }
  if (parsed.action === "route") {
    if (opts.userId !== run.requesterId && !admin) return "Only the requester can pick.";
    const route = decodeURIComponent(parsed.extra || "/");
    run.request = `${run.originalAsk || run.request} (on ${route})`;
    saveRun(run);
    enqueueStart(run.id, run.pendingAttachments || []);
    return;
  }
  if (parsed.action === "attach") {
    if (opts.userId !== run.requesterId && !admin) return "Only the requester can pick.";
    const role = parsed.extra as "match" | "spec" | "asset";
    const files = (run.pendingAttachments || []).map((f) => ({ ...f, role }));
    run.pendingAttachments = files;
    saveRun(run);
    const phrase =
      role === "match" ? "match this" : role === "spec" ? "read this as spec" : "put this in the repo";
    if (run.status === "classifying" && !run.prNumber) {
      run.request =
        run.originalAsk && run.originalAsk !== "(see attached file)" ? `${run.originalAsk} — ${phrase}` : phrase;
      saveRun(run);
      enqueueStart(run.id, files);
      return;
    }
    enqueueIterate(run.id, phrase, files);
  }
  return undefined;
}
