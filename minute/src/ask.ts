import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { complete, completeJson } from "./llm.js";
import { looksLikeScratchAsk } from "./scratch.js";

export const PICK_ASK = "minute:pick:ask";
export const MODAL_ASK = "minute:modal:ask-repo";

export type RunKind = "tweak" | "scratch" | "ask";

export type GithubLink = {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  pr?: number;
  url: string;
};

const RESERVED = new Set([
  "settings",
  "orgs",
  "marketplace",
  "topics",
  "about",
  "login",
  "apps",
  "features",
  "pricing",
  "enterprise",
  "security",
  "notifications",
  "explore",
  "codespaces",
  "sponsors",
  "collections",
  "events",
  "new",
  "organizations",
  "account",
  "signup",
]);

const SKIP_DIR = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
  "target",
  ".minute",
  ".data",
]);

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".graphql",
]);

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "it",
  "this",
  "that",
  "how",
  "what",
  "where",
  "why",
  "does",
  "do",
  "can",
  "you",
  "me",
  "please",
  "about",
  "with",
  "from",
  "into",
  "https",
  "http",
  "github",
  "com",
  "www",
]);

const QUESTION =
  /\b(how|what|where|why|explain|does|did|implement|implementation|concept|works?|mean|which|walk|show me|tell me|describe|find|look(?:ing)? at|break down|is this|are we|can you)\b/i;

export function parseGithubUrl(text: string): GithubLink | undefined {
  const match = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s<>"'`]+/i);
  if (!match) return undefined;
  let raw = match[0].replace(/[),.;]+$/g, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo || RESERVED.has(owner.toLowerCase())) return undefined;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return undefined;

  const out: GithubLink = { owner, repo, url: `https://github.com/${owner}/${repo}` };
  const kind = parts[2];
  if (kind === "tree" || kind === "blob") {
    if (parts[3]) out.ref = parts[3];
    const rest = parts.slice(4).join("/");
    if (rest) out.path = rest.replace(/#.*$/, "");
  } else if (kind === "pull" && parts[3] && /^\d+$/.test(parts[3])) {
    out.pr = Number(parts[3]);
  } else if (kind === "commit" && parts[3] && /^[0-9a-f]{7,40}$/i.test(parts[3])) {
    out.ref = parts[3];
  }
  return out;
}

export function looksLikeRepoAsk(text: string): boolean {
  return Boolean(parseGithubUrl(text));
}

export function parseShowFileAsk(text: string): string | undefined {
  const m = text.match(
    /\bshow(?:\s+me)?(?:\s+that)?(?:\s+file)?\s+[`'"]?([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})[`'"]?/i,
  );
  return m?.[1]?.replace(/^\/+/, "");
}

export function looksLikeWhereLive(text: string): boolean {
  return /\bwhere would\b.*\b(live|go|change|edit|sit)\b/i.test(text) || /\bwhere (?:does|would) this (?:change )?live\b/i.test(text);
}

export function snippetFromRepo(root: string, rel: string, max = 1200): string | undefined {
  const files = walkFiles(root);
  const hit =
    files.find((f) => f === rel || f.endsWith(`/${rel}`) || f.endsWith(rel)) ||
    files.find((f) => f.toLowerCase().endsWith(rel.toLowerCase()));
  if (!hit) return undefined;
  let body = "";
  try {
    body = readFileSync(join(root, hit), "utf8");
  } catch {
    return undefined;
  }
  const clipped = body.length > max ? `${body.slice(0, max)}\n…` : body;
  return `**${hit}**\n\`\`\`\n${clipped}\n\`\`\``;
}

export function questionFromAsk(text: string): string {
  const stripped = text
    .replace(/https?:\/\/(?:www\.)?github\.com\/[^\s<>"'`]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    stripped ||
    "Give me a clear overview of this repo: what it is, how it’s structured, and where the main logic lives."
  );
}

export function inferRunKind(
  text: string,
  playground?: { github: { owner: string; repo: string } },
  explicit?: RunKind,
): RunKind {
  if (explicit) return explicit;
  const gh = parseGithubUrl(text);
  if (gh) {
    const same =
      playground &&
      gh.owner.toLowerCase() === playground.github.owner.toLowerCase() &&
      gh.repo.toLowerCase() === playground.github.repo.toLowerCase();
    if (!same || QUESTION.test(text)) return "ask";
  }
  if (looksLikeScratchAsk(text)) return "scratch";
  return "tweak";
}

function tokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function walkFiles(root: string, rel = ""): string[] {
  const dir = rel ? join(root, rel) : root;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".") && name !== ".github") continue;
    const nextRel = rel ? `${rel}/${name}` : name;
    const full = join(root, nextRel);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR.has(name)) continue;
      if (out.length > 4000) continue;
      out.push(...walkFiles(root, nextRel));
    } else if (st.isFile()) {
      if (st.size > 120_000) continue;
      const ext = extname(name).toLowerCase();
      if (!CODE_EXT.has(ext)) continue;
      out.push(nextRel);
    }
  }
  return out;
}

function scoreFile(rel: string, toks: string[], prefer?: string): number {
  const lower = rel.toLowerCase();
  let score = 0;
  if (prefer && (lower === prefer.toLowerCase() || lower.endsWith(`/${prefer.toLowerCase()}`))) score += 1000;
  if (/(^|\/)readme(\.|$)/i.test(rel)) score += 40;
  if (/(^|\/)(src|lib|app|server|backend|frontend|code|metrics|pe_encodings)\//i.test(rel)) score += 8;
  for (const t of toks) {
    if (lower.includes(t)) score += 24;
    const base = lower.split("/").pop() || "";
    if (base.includes(t)) score += 16;
  }
  return score;
}

export function selectRepoFiles(
  root: string,
  question: string,
  preferPath?: string,
  limit = 16,
): Array<{ path: string; body: string }> {
  const toks = tokens(question);
  const files = walkFiles(root);
  const ranked = files
    .map((path) => ({ path, score: scoreFile(path, toks, preferPath) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const chosen: string[] = [];
  const prefer = preferPath
    ? files.find((f) => f === preferPath || f.endsWith(`/${preferPath}`))
    : undefined;
  if (prefer) chosen.push(prefer);
  for (const row of ranked) {
    if (chosen.includes(row.path)) continue;
    if (row.score <= 0 && chosen.length >= 6) continue;
    chosen.push(row.path);
    if (chosen.length >= limit) break;
  }

  const out: Array<{ path: string; body: string }> = [];
  let budget = 90_000;
  for (const path of chosen) {
    if (budget < 800) break;
    try {
      let body = readFileSync(join(root, path), "utf8");
      if (body.length > Math.min(20_000, budget)) body = `${body.slice(0, Math.min(20_000, budget))}\n…`;
      budget -= body.length;
      out.push({ path, body });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

export function repoTreeSketch(root: string): string {
  if (!existsSync(root)) return "";
  const names = readdirSync(root)
    .filter((n) => n !== ".git")
    .slice(0, 24);
  return names
    .map((n) => {
      try {
        return statSync(join(root, n)).isDirectory() ? `${n}/` : n;
      } catch {
        return n;
      }
    })
    .join("  ");
}

export function formatRepoContext(files: Array<{ path: string; body: string }>): string {
  return files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.body}\n\`\`\``)
    .join("\n\n")
    .slice(0, 95_000);
}

export type PointerStep = { path: string; name?: string; what: string };

export type PointerAnswer = {
  lede: string;
  start: { path: string; name?: string; why: string };
  steps: PointerStep[];
  idea?: string;
};

function pointer(path: string, name?: string): string {
  const p = path.trim();
  const n = name?.trim();
  if (p && n) return `\`${p}\` → \`${n}\``;
  if (p) return `\`${p}\``;
  if (n) return `\`${n}\``;
  return "";
}

export function renderPointerAnswer(a: PointerAnswer): string {
  const lede = (a.lede || "").trim();
  const startWhy = (a.start?.why || "").trim();
  const startPtr = pointer(a.start?.path || "", a.start?.name);
  const steps = (a.steps || [])
    .filter((s) => (s.path || s.name || s.what || "").trim())
    .slice(0, 8)
    .map((s, i) => {
      const p = pointer(s.path || "", s.name);
      const what = (s.what || "").trim();
      return p && what ? `${i + 1}. ${p} — ${what}` : what ? `${i + 1}. ${what}` : `${i + 1}. ${p}`;
    });
  const idea = (a.idea || "").trim();
  const parts = [
    lede ? `**What this is**\n${lede}` : "",
    startPtr || startWhy ? `**Start here**\n${[startPtr, startWhy].filter(Boolean).join(" — ")}` : "",
    steps.length ? `**Follow**\n${steps.join("\n")}` : "",
    idea ? `**The idea**\n${idea}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").trim();
}

export function looksLikeInventory(text: string): boolean {
  return /####\s|Function:\s|File:\s|Implementation:\s|Below is a breakdown|The code includes several|This breakdown provides/i.test(
    text,
  );
}

export async function answerRepoQuestion(opts: {
  question: string;
  repoLabel: string;
  description?: string;
  tree: string;
  files: Array<{ path: string; body: string }>;
}): Promise<string> {
  const context = formatRepoContext(opts.files);
  const brief = `Repo: ${opts.repoLabel}
${opts.description ? `GitHub description: ${opts.description}\n` : ""}Top-level: ${opts.tree || "(empty)"}

Question:
${opts.question}

Code (source of truth — do not invent files):
${context || "(no matching files were readable)"}`;

  try {
    const raw = await completeJson<PointerAnswer>(
      `${brief}

Walk a human through this repo. Return JSON:
{
  "lede": "one sentence: what this is",
  "start": { "path": "file/path", "name": "symbol or empty", "why": "why begin here" },
  "steps": [{ "path": "file/path", "name": "symbol", "what": "what happens, in English" }],
  "idea": "the concept, then how the code does it"
}
Rules: 3–6 steps. Every step has a real path from the files. No Function/File/Implementation lists. No recap. No offer to edit.`,
      { maxTokens: 1400 },
    );
    const rendered = renderPointerAnswer(raw);
    if (rendered && !looksLikeInventory(rendered)) return rendered;
  } catch {
    // fall through to prose
  }

  const text = await complete(
    `${brief}

Walk a human through the code. Use exactly these headings:

**What this is**
**Start here**
**Follow**
**The idea**

Under Follow, numbered pointers like: 1. \`path\` → \`symbol\` — what it does.
Forbidden: Function:/File:/Implementation: lists, "below is a breakdown", a Summary recap.
Cite only files that appear above. Discord markdown. No preamble.`,
    {
      maxTokens: 1600,
      system:
        "You walk a person through a GitHub repo with file pointers. Human, structured, no catalogs.",
    },
  );
  const clean = text.replace(/\s+$/g, "").trim();
  return clean || "I cloned the repo but couldn’t form an answer. Try a more specific question.";
}

export function splitAnswer(text: string, max = 3800): string[] {
  const clean = text.replace(/\0/g, "").trim();
  if (clean.length <= max) return [clean];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length) {
    if (rest.length <= max) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks.slice(0, 4);
}
