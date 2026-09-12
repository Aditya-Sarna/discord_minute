import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAllowedPath, normalizeRepoPath } from "./paths.js";
import { LIMITS } from "./limits.js";

export type PatchOp =
  | { kind: "replace"; path: string; search: string; replace: string }
  | { kind: "create"; path: string; content: string };

const HINT_STOP = new Set([
  "the", "and", "for", "make", "with", "this", "that", "from", "into", "page", "please",
]);

function hitCount(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function hintTerms(hint?: string): string[] {
  if (!hint) return [];
  return hint
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !HINT_STOP.has(w));
}

function matchIndexes(content: string, search: string): number[] {
  const out: number[] = [];
  let from = 0;
  while (out.length < 80) {
    const i = content.indexOf(search, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(search.length, 1);
  }
  return out;
}

function pickMatchIndex(content: string, search: string, hint?: string): number {
  const indexes = matchIndexes(content, search);
  if (indexes.length === 0) return -1;
  if (indexes.length === 1) return indexes[0];
  const terms = hintTerms(hint);
  if (terms.length === 0) return indexes[0];
  let best = indexes[0];
  let bestScore = -1;
  for (const i of indexes) {
    const window = content.slice(Math.max(0, i - 96), i).toLowerCase();
    let score = 0;
    for (const t of terms) {
      const at = window.lastIndexOf(t);
      if (at >= 0) score += 100 + at;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function expandNeedle(
  content: string,
  search: string,
  startAt: number,
): { needle: string; start: number } | null {
  let start = startAt;
  let end = startAt + search.length;
  let guard = 0;
  while (hitCount(content, content.slice(start, end)) > 1 && guard++ < 240) {
    const before = start;
    const after = end;
    if (start > 0) {
      const nl = content.lastIndexOf("\n", start - 1);
      start = nl < 0 ? 0 : nl;
    }
    if (hitCount(content, content.slice(start, end)) > 1 && end < content.length) {
      const nl = content.indexOf("\n", end);
      end = nl < 0 ? content.length : nl + 1;
    }
    if (start === before && end === after) {
      if (start > 0) start -= 1;
      else if (end < content.length) end += 1;
      else break;
    }
    if (end - start > 8_000) return null;
  }
  const needle = content.slice(start, end);
  if (hitCount(content, needle) !== 1) return null;
  if (content.slice(startAt, startAt + search.length) !== search) return null;
  return { needle, start };
}

export function applyUniqueReplace(content: string, search: string, replace: string, hint?: string): string {
  if (!search) throw new Error("Empty search");
  const hits = hitCount(content, search);
  if (hits === 0) throw new Error("Search not found");
  if (hits === 1) return content.replace(search, replace);
  const at = pickMatchIndex(content, search, hint);
  const expanded = expandNeedle(content, search, at);
  if (!expanded) throw new Error(`Search not unique (${hits} hits)`);
  const { needle, start } = expanded;
  const offset = at - start;
  const nextNeedle = needle.slice(0, offset) + replace + needle.slice(offset + search.length);
  return content.replace(needle, nextNeedle);
}

export function applyPatchOps(
  root: string,
  allow: string[],
  ops: PatchOp[],
  hint?: string,
): string[] {
  if (ops.length === 0) throw new Error("No edits.");
  if (ops.length > LIMITS.maxEditFiles) {
    throw new Error(`Too many files (max ${LIMITS.maxEditFiles}).`);
  }
  const written: string[] = [];
  for (const op of ops) {
    const rel = normalizeRepoPath(op.path);
    if (!isAllowedPath(rel, allow)) {
      throw new Error(`Blocked path: ${op.path}`);
    }
    const dest = join(root, rel);
    if (op.kind === "create") {
      if (Buffer.byteLength(op.content) > LIMITS.maxFileBytes) {
        throw new Error(`File too large: ${rel}`);
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, op.content);
      written.push(rel);
      continue;
    }
    if (!existsSync(dest)) throw new Error(`Missing file: ${rel}`);
    const current = readFileSync(dest, "utf8");
    let next: string;
    try {
      next = applyUniqueReplace(current, op.search, op.replace, hint);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("Search not found")) throw new Error(`Search not found in ${rel}`);
      if (msg.startsWith("Search not unique")) {
        throw new Error(`Search not unique in ${rel} (${hitCount(current, op.search)} hits)`);
      }
      throw err;
    }
    if (Buffer.byteLength(next) > LIMITS.maxFileBytes) {
      throw new Error(`File too large after edit: ${rel}`);
    }
    writeFileSync(dest, next);
    written.push(rel);
  }
  return [...new Set(written)];
}
