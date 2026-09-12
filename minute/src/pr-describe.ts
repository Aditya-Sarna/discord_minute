import type { Playground, Proof, Run } from "./types.js";
import { repoLabel } from "./config.js";

export function filesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) files.add(m[2]);
  }
  return [...files].filter((f) => !f.startsWith(".minute/"));
}

export function titleFromChange(summary: string): string {
  const clean = summary.replace(/\s+/g, " ").replace(/^minute:\s*/i, "").trim();
  return `minute: ${clean.slice(0, 72)}`;
}

export function prBodyFromChange(opts: {
  playground: Playground;
  run: Run;
  summary: string;
  diff: string;
  proof: Proof;
  signedOff: boolean;
  threadUrl?: string;
}): string {
  const files = opts.proof.filesChanged.length
    ? opts.proof.filesChanged
    : filesFromDiff(opts.diff);
  const photo = opts.proof.afterPath
    ? `![After — this branch](https://github.com/${opts.playground.github.owner}/${opts.playground.github.repo}/blob/${opts.run.branch}/.minute/${opts.run.id}-after.png?raw=true)`
    : opts.proof.skippedReason || "No live photo.";
  const phone = opts.proof.phonePath
    ? `![Phone crop](https://github.com/${opts.playground.github.owner}/${opts.playground.github.repo}/blob/${opts.run.branch}/.minute/${opts.run.id}-after-phone.png?raw=true)`
    : "";
  const using = (opts.run.attachmentNotes ?? []).length
    ? opts.run.attachmentNotes!.map((n) => `- ${n}`).join("\n")
    : "";
  const ask = (opts.run.originalAsk || opts.run.request).split("\n")[0].slice(0, 240);

  const hunkHints = files.map((f) => `- \`${f}\``).join("\n") || "- —";

  return [
    `## What changed`,
    ``,
    opts.summary.trim(),
    ``,
    `## Files`,
    ``,
    hunkHints,
    ``,
    `## Proof`,
    ``,
    photo,
    phone,
    opts.proof.skippedReason && opts.proof.afterPath ? `_${opts.proof.skippedReason}_` : "",
    ``,
    `Route: \`${opts.proof.route}\` · Playground \`${opts.playground.id}\` · ${repoLabel(opts.playground)}`,
    ``,
    `Asked in Discord by **${opts.run.requesterName}**: ${ask}`,
    using ? `\nReference:\n${using}` : "",
    opts.threadUrl ? `Thread: ${opts.threadUrl}` : "",
    ``,
    opts.signedOff
      ? `**Visual sign-off:** yes. Review on technical grounds (approve / disapprove).`
      : `**Visual sign-off:** not yet. Still iterating in chat.`,
  ]
    .filter((line) => line !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
