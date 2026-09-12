import { extname } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { LIMITS } from "./limits.js";
import type { Attachment, AttachmentRole } from "./types.js";

const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOC = new Set([".txt", ".md", ".markdown", ".csv", ".html", ".htm", ".pdf", ".docx", ".doc"]);
const ASSET = new Set([".svg", ".ico", ".woff", ".woff2"]);

export type ClassifiedAttachment = Attachment & {
  role: AttachmentRole;
  reason?: string;
};

export function classifyFilename(name: string): AttachmentRole | "refuse" {
  const ext = extname(name).toLowerCase();
  if (IMAGE.has(ext)) return "match";
  if (DOC.has(ext)) return "spec";
  if (ASSET.has(ext)) return "asset";
  return "refuse";
}

export function inferAttachRole(text: string, names: string[]): AttachmentRole | "need_intent" | "refuse" {
  if (!names.length) return "need_intent";
  const kinds = names.map(classifyFilename);
  if (kinds.some((k) => k === "refuse")) return "refuse";
  const lower = text.toLowerCase();
  if (/\b(put this|use this|add this|logo|in the (header|repo|app|nav))\b/.test(lower)) return "asset";
  if (/\b(like this|look like|match|mock|screenshot|from this)\b/.test(lower)) return "match";
  if (/\b(notes?|brief|copy|spec|from this doc|pdf)\b/.test(lower)) return "spec";
  if (!text.trim()) return "need_intent";
  if (kinds.every((k) => k === "spec")) return "spec";
  if (kinds.every((k) => k === "asset")) return "asset";
  if (kinds.every((k) => k === "match")) return "match";
  return "need_intent";
}

export function applyRole(files: Attachment[], role: AttachmentRole): ClassifiedAttachment[] {
  return files.map((f) => ({ ...f, role }));
}

export function extractSpecText(file: Attachment, cap = 8_000): string {
  if (!file.localPath) return "";
  const ext = extname(file.name).toLowerCase();
  if (![".txt", ".md", ".markdown", ".csv", ".html", ".htm"].includes(ext)) {
    return `[attached ${file.name} — treat as spec]`;
  }
  try {
    let text = readFileSync(file.localPath, "utf8");
    if (ext === ".html" || ext === ".htm") text = text.replace(/<[^>]+>/g, " ");
    return text.replace(/\s+/g, " ").trim().slice(0, cap);
  } catch {
    return `[attached ${file.name}]`;
  }
}

export function withinAttachLimits(files: Attachment[]): string | undefined {
  if (files.length > LIMITS.maxAttachments) {
    return `That’s ${files.length} files — I can take ${LIMITS.maxAttachments} at a time.`;
  }
  for (const f of files) {
    if (!f.localPath) continue;
    try {
      const n = statSync(f.localPath).size;
      if (n > LIMITS.maxAttachBytes) {
        return `${f.name} is too large (max ${Math.round(LIMITS.maxAttachBytes / 1024 / 1024)}MB).`;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function refusedNames(names: string[]): string[] {
  return names.filter((n) => classifyFilename(n) === "refuse");
}

export function attachmentPromptBlock(files: ClassifiedAttachment[]): string {
  if (!files.length) return "";
  const lines = files.map((f) => {
    if (f.role === "match") return `Reference image to MATCH (do not commit unless it belongs in the product): ${f.name}${f.localPath ? ` at ${f.localPath}` : ""}`;
    if (f.role === "spec") return `Spec/copy from ${f.name}:\n${extractSpecText(f)}`;
    if (f.role === "asset") return `Product asset to PLACE in allow.paths: ${f.name}${f.localPath ? ` at ${f.localPath}` : ""}`;
    return `${f.name} (${f.role})`;
  });
  return `\nAttachments:\n${lines.join("\n")}\n`;
}
