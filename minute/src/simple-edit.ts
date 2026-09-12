import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { applyUniqueReplace } from "./patch.js";
import { isAllowedPath, normalizeRepoPath } from "./paths.js";

const COLORS: Record<string, string> = {
  green: "#228B22",
  blue: "#2563eb",
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  purple: "#7c3aed",
  pink: "#db2777",
  black: "#111111",
  white: "#ffffff",
  gray: "#6b7280",
  grey: "#6b7280",
  teal: "#0d9488",
  navy: "#1e3a8a",
};

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const TARGETS = "header|footer|button|background|bg|title|nav|navbar|sidebar|hero|link|badge|h1";
const TEXT_EXT = new Set([".css", ".html", ".htm", ".jsx", ".tsx", ".js", ".ts", ".vue", ".svelte"]);

export type VisualOpKind = "color" | "shift" | "hide" | "show" | "type" | "copy" | "nudge";

export type LastVisualOp = {
  kind: VisualOpKind;
  target?: string;
  hex?: string;
  size?: string;
  file?: string;
  summary: string;
};

export type SimpleEditResult = {
  files: string[];
  summary: string;
  routeHint: string;
  lastOp: LastVisualOp;
};

function normalize(request: string): string {
  return request.toLowerCase().replace(/\s+/g, " ").trim();
}

function namedTarget(lower: string, fallback?: string): string | undefined {
  const m = lower.match(new RegExp(`\\b(${TARGETS})\\b`));
  const raw = m?.[1];
  if (!raw) return fallback;
  return raw === "bg" ? "background" : raw;
}

export function parseSimpleVisual(request: string): { target: string; color: string; hex: string } | undefined {
  const lower = normalize(request);
  const forest = lower.match(/\bforest green\b/);
  const colorName = forest
    ? "green"
    : Object.keys(COLORS)
        .sort((a, b) => b.length - a.length)
        .find((c) => new RegExp(`\\b${c}\\b`).test(lower));
  if (!colorName) return undefined;
  if (lower.split(/\s+/).length > 16) return undefined;
  if (/\b(add|create|build|implement|rewrite|login|auth)\b/.test(lower)) return undefined;
  const hex = forest ? "#228B22" : COLORS[colorName];
  const target = namedTarget(lower, "header") || "header";
  if (!/\b(make|change|set|turn|paint|color)\b/.test(lower) && !/\b(green|blue|red)\b/.test(lower)) {
    return undefined;
  }
  return { target, color: forest ? "forest green" : colorName, hex };
}

export function parseSimpleHide(request: string): { target: string } | undefined {
  const lower = normalize(request);
  if (lower.split(/\s+/).length > 12) return undefined;
  const m = lower.match(new RegExp(`\\b(?:hide|take off|remove)\\s+(?:the\\s+)?(${TARGETS}|bar)\\b`));
  if (!m) return undefined;
  const target = m[1] === "bg" ? "background" : m[1] === "bar" ? "header" : m[1];
  return { target };
}

export function parseSimpleShow(request: string): { target: string } | undefined {
  const lower = normalize(request);
  if (lower.split(/\s+/).length > 12) return undefined;
  const m = lower.match(new RegExp(`\\bshow\\s+(?:the\\s+)?(${TARGETS})\\b`));
  if (!m) return undefined;
  return { target: m[1] === "bg" ? "background" : m[1] };
}

export function parseSimpleType(request: string): { target: string; size: string } | undefined {
  const lower = normalize(request);
  if (lower.split(/\s+/).length > 12) return undefined;
  const bigger =
    /\b(bigger|larger|increase)\b.*\b(type|font|text|copy)\b/.test(lower) ||
    /\b(type|font|text)\b.*\b(bigger|larger)\b/.test(lower);
  const smaller =
    /\b(smaller|decrease)\b.*\b(type|font|text|copy)\b/.test(lower) ||
    /\b(type|font|text)\b.*\b(smaller)\b/.test(lower);
  if (!bigger && !smaller) return undefined;
  return { target: namedTarget(lower, "body") || "body", size: bigger ? "1.35em" : "0.85em" };
}

export function parseSimpleShift(
  request: string,
): { mode: "darker" | "lighter" | "warmer" | "cooler" | "softer" } | undefined {
  const lower = normalize(request);
  if (lower.split(/\s+/).length > 14) return undefined;
  if (/\b(a bit |bit |more )?(darker|less loud)\b/.test(lower)) return { mode: "darker" };
  if (/\b(a bit |bit |more )?lighter\b/.test(lower)) return { mode: "lighter" };
  if (/\b(a bit |bit |more )?warmer\b/.test(lower)) return { mode: "warmer" };
  if (/\b(a bit |bit |more )?cooler\b/.test(lower)) return { mode: "cooler" };
  if (/\bless loud\b/.test(lower)) return { mode: "softer" };
  return undefined;
}

export function parseSimpleCopy(request: string): { next: string; target?: string } | undefined {
  const raw = request.replace(/\s+/g, " ").trim();
  if (raw.split(/\s+/).length > 20) return undefined;
  const quoted = raw.match(/\bsay\s+["“]([^"”]{1,60})["”]\s+instead\b/i);
  if (quoted?.[1]) return { next: quoted[1].trim() };
  const titled = raw.match(
    /\b(?:change|set)\s+(?:the\s+)?(title|heading|h1|button|label|copy)\s+to\s+["“]?([^"”\n]{1,60})["”]?\s*$/i,
  );
  if (titled?.[2]) return { next: titled[2].trim(), target: titled[1].toLowerCase() };
  const say = raw.match(/\bmake it say\s+["“]?([^"”\n]{1,60})["”]?\s*$/i);
  if (say?.[1]) return { next: say[1].trim() };
  return undefined;
}

export function parseSimpleNudge(request: string): { kind: "left" | "space"; target: string } | undefined {
  const lower = normalize(request);
  if (lower.split(/\s+/).length > 14) return undefined;
  if (/\b(left side|on the left|align left)\b/.test(lower)) {
    return { kind: "left", target: namedTarget(lower, "header") || "header" };
  }
  if (/\b(more space|more room|space under)\b/.test(lower)) {
    return { kind: "space", target: namedTarget(lower, "title") || "title" };
  }
  return undefined;
}

export function parseRepeatTarget(request: string): string | undefined {
  const lower = normalize(request);
  const m = lower.match(
    new RegExp(`\\b(?:do that to|same thing on|also)\\s+(?:the\\s+)?(${TARGETS})\\b`),
  );
  if (!m) return undefined;
  return m[1] === "bg" ? "background" : m[1];
}

export function parseUndo(request: string): boolean {
  return /^(undo( that)?|revert( that)?|go back|put it back)\.?$/i.test(request.trim());
}

export function parseShowMobile(request: string): boolean {
  return /\b(show me )?(mobile|phone)( (view|photo|shot|frame))?\b/i.test(request) && request.split(/\s+/).length <= 8;
}

export function shiftHex(hex: string, mode: "darker" | "lighter" | "warmer" | "cooler" | "softer"): string {
  const m = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(m)) return hex;
  let r = parseInt(m.slice(0, 2), 16);
  let g = parseInt(m.slice(2, 4), 16);
  let b = parseInt(m.slice(4, 6), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  if (mode === "darker") {
    r *= 0.78;
    g *= 0.78;
    b *= 0.78;
  } else if (mode === "lighter") {
    r = r + (255 - r) * 0.22;
    g = g + (255 - g) * 0.22;
    b = b + (255 - b) * 0.22;
  } else if (mode === "warmer") {
    r = Math.min(255, r * 1.08 + 12);
    b *= 0.88;
  } else if (mode === "cooler") {
    b = Math.min(255, b * 1.08 + 12);
    r *= 0.88;
  } else {
    r = r + (128 - r) * 0.2;
    g = g + (128 - g) * 0.2;
    b = b + (128 - b) * 0.2;
  }
  const to = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function walkFiles(root: string, allow: string[], exts: Set<string>, cap = 60): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= cap) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if ([...exts].some((e) => name.endsWith(e))) {
        const rel = relative(root, full).replaceAll("\\", "/");
        if (isAllowedPath(rel, allow)) out.push(rel);
      }
      if (out.length >= cap) return;
    }
  };
  for (const p of allow) {
    const abs = resolve(root, p);
    try {
      const st = statSync(abs);
      const rel = normalizeRepoPath(p);
      if (st.isFile() && [...exts].some((e) => abs.endsWith(e)) && isAllowedPath(rel, allow)) {
        out.push(rel);
        continue;
      }
    } catch {
      continue;
    }
    walk(abs);
  }
  return out;
}

function cssFiles(root: string, allow: string[]): string[] {
  return walkFiles(root, allow, new Set([".css"]));
}

function markupFiles(root: string, allow: string[]): string[] {
  return walkFiles(root, allow, TEXT_EXT);
}

function paintCss(content: string, target: string, hex: string, request: string): string | undefined {
  const colorProp = target === "background" ? "background" : "color";
  const re = new RegExp(`(${target}[^{}]*\\{[^}]*?)(${colorProp}\\s*:\\s*)([^;}]+)`, "i");
  const m = content.match(re);
  if (m && m.index != null) {
    try {
      return applyUniqueReplace(content, m[0], `${m[1]}${m[2]}${hex}`, request);
    } catch {
      // fall through
    }
  }
  const loose = content.match(new RegExp(`(${colorProp}\\s*:\\s*)([^;}]+)`, "i"));
  if (loose && loose[0]) {
    try {
      return applyUniqueReplace(content, loose[0], `${loose[1]}${hex}`, request);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractHex(content: string, target?: string): string | undefined {
  if (target) {
    const block = content.match(new RegExp(`${target}[^{}]*\\{([^}]+)\\}`, "i"));
    const hex = block?.[1]?.match(/#([0-9a-f]{6})\b/i);
    if (hex) return `#${hex[1]}`;
  }
  const any = content.match(/#([0-9a-f]{6})\b/i);
  return any ? `#${any[1]}` : undefined;
}

function hideCss(content: string, target: string, request: string): string | undefined {
  const re = new RegExp(`(${target}[^{}]*\\{)`, "i");
  const m = content.match(re);
  if (m && m[0]) {
    try {
      return applyUniqueReplace(content, m[0], `${m[1]} display: none;`, request);
    } catch {
      // fall through
    }
  }
  return `${content.trimEnd()}\n${target} { display: none; }\n`;
}

function showCss(content: string, target: string, request: string): string | undefined {
  const hidden = content.match(
    new RegExp(`(${target}[^{}]*\\{[^}]*?)(display\\s*:\\s*none\\s*;)`, "i"),
  );
  if (hidden && hidden[0]) {
    try {
      return applyUniqueReplace(content, hidden[0], `${hidden[1]}display: block;`, request);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function typeCss(content: string, target: string, size: string, request: string): string | undefined {
  const sized = content.match(new RegExp(`(${target}[^{}]*\\{[^}]*?)(font-size\\s*:\\s*)([^;}]+)`, "i"));
  if (sized && sized[0]) {
    try {
      return applyUniqueReplace(content, sized[0], `${sized[1]}${sized[2]}${size}`, request);
    } catch {
      // fall through
    }
  }
  const block = content.match(new RegExp(`(${target}[^{}]*\\{)`, "i"));
  if (block && block[0]) {
    try {
      return applyUniqueReplace(content, block[0], `${block[1]} font-size: ${size};`, request);
    } catch {
      // fall through
    }
  }
  return `${content.trimEnd()}\n${target} { font-size: ${size}; }\n`;
}

function nudgeCss(
  content: string,
  target: string,
  kind: "left" | "space",
  request: string,
): string | undefined {
  const sel = target === "title" ? "h1" : target;
  const prop = kind === "left" ? "text-align: left;" : "margin-bottom: 2rem;";
  const block = content.match(new RegExp(`(${sel}[^{}]*\\{)`, "i"));
  if (block && block[0]) {
    try {
      return applyUniqueReplace(content, block[0], `${block[1]} ${prop}`, request);
    } catch {
      // fall through
    }
  }
  return `${content.trimEnd()}\n${sel} { ${prop} }\n`;
}

function copyMarkup(content: string, next: string, target?: string): string | undefined {
  const escaped = next.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const heading = /<h1([^>]*)>([^<]*)<\/h1>/i;
  const button = /<(button)([^>]*)>([^<]*)<\/button>/i;
  if (target === "button" || target === "label") {
    const m = content.match(button);
    if (m) return content.replace(m[0], `<${m[1]}${m[2]}>${escaped}</${m[1]}>`);
  }
  const m = content.match(heading);
  if (m) return content.replace(m[0], `<h1${m[1]}>${escaped}</h1>`);
  const jsx = content.match(/<h1([^>]*)>\s*\{?["'`]([^"'`]+)["'`]\}?\s*<\/h1>/);
  if (jsx) return content.replace(jsx[0], `<h1${jsx[1]}>${escaped}</h1>`);
  return undefined;
}

function writeFirstHit(
  files: string[],
  root: string,
  apply: (current: string) => string | undefined,
  summary: string,
  lastOp: LastVisualOp,
): SimpleEditResult | undefined {
  for (const file of files) {
    const current = readFileSync(join(root, file), "utf8");
    const next = apply(current);
    if (!next || next === current) continue;
    writeFileSync(join(root, file), next);
    return { files: [file], summary, routeHint: "/", lastOp: { ...lastOp, file } };
  }
  return undefined;
}

function replayOp(
  root: string,
  allow: string[],
  request: string,
  last: LastVisualOp,
  target: string,
): SimpleEditResult | undefined {
  const css = cssFiles(root, allow);
  if (last.kind === "color" && last.hex) {
    return writeFirstHit(css, root, (c) => paintCss(c, target, last.hex!, request), `${target} ${last.hex}`, {
      ...last,
      target,
      summary: `${target} ${last.hex}`,
    });
  }
  if (last.kind === "hide") {
    return writeFirstHit(css, root, (c) => hideCss(c, target, request), `hide ${target}`, {
      kind: "hide",
      target,
      summary: `hide ${target}`,
    });
  }
  if (last.kind === "type" && last.size) {
    return writeFirstHit(css, root, (c) => typeCss(c, target, last.size!, request), `${target} type ${last.size}`, {
      kind: "type",
      target,
      size: last.size,
      summary: `${target} type ${last.size}`,
    });
  }
  if (last.kind === "nudge") {
    return writeFirstHit(
      css,
      root,
      (c) => nudgeCss(c, target, "left", request),
      `${target} left`,
      { kind: "nudge", target, summary: `${target} left` },
    );
  }
  return undefined;
}

/** Deterministic visual edits so common English tweaks do not depend on a 7B JSON guess. */
export function trySimpleVisualEdit(
  root: string,
  allow: string[],
  request: string,
  lastOp?: LastVisualOp,
): SimpleEditResult | undefined {
  const css = cssFiles(root, allow);
  const markup = markupFiles(root, allow);

  const repeat = parseRepeatTarget(request);
  if (repeat && lastOp) {
    return replayOp(root, allow, request, lastOp, repeat);
  }

  const hide = parseSimpleHide(request);
  if (hide) {
    return writeFirstHit(css, root, (c) => hideCss(c, hide.target, request), `hide ${hide.target}`, {
      kind: "hide",
      target: hide.target,
      summary: `hide ${hide.target}`,
    });
  }

  const show = parseSimpleShow(request);
  if (show) {
    return writeFirstHit(css, root, (c) => showCss(c, show.target, request), `show ${show.target}`, {
      kind: "show",
      target: show.target,
      summary: `show ${show.target}`,
    });
  }

  const type = parseSimpleType(request);
  if (type) {
    return writeFirstHit(
      css,
      root,
      (c) => typeCss(c, type.target, type.size, request),
      `${type.target} type ${type.size}`,
      { kind: "type", target: type.target, size: type.size, summary: `${type.target} type ${type.size}` },
    );
  }

  const copy = parseSimpleCopy(request);
  if (copy) {
    return writeFirstHit(
      markup,
      root,
      (c) => copyMarkup(c, copy.next, copy.target),
      `say ${copy.next}`,
      { kind: "copy", summary: `say ${copy.next}` },
    );
  }

  const nudge = parseSimpleNudge(request);
  if (nudge) {
    return writeFirstHit(
      css,
      root,
      (c) => nudgeCss(c, nudge.target, nudge.kind, request),
      nudge.kind === "left" ? `${nudge.target} left` : `space under ${nudge.target}`,
      {
        kind: "nudge",
        target: nudge.target,
        summary: nudge.kind === "left" ? `${nudge.target} left` : `space under ${nudge.target}`,
      },
    );
  }

  const shift = parseSimpleShift(request);
  if (shift) {
    return writeFirstHit(
      css,
      root,
      (c) => {
        const from = lastOp?.hex || extractHex(c, lastOp?.target || namedTarget(normalize(request)));
        if (!from) return undefined;
        const hex = shiftHex(from, shift.mode);
        return paintCss(c, lastOp?.target || namedTarget(normalize(request), "header") || "header", hex, request);
      },
      shift.mode,
      {
        kind: "shift",
        target: lastOp?.target,
        hex: lastOp?.hex ? shiftHex(lastOp.hex, shift.mode) : undefined,
        summary: shift.mode,
      },
    );
  }

  const parsed = parseSimpleVisual(request);
  if (!parsed) return undefined;
  return writeFirstHit(
    css,
    root,
    (c) => paintCss(c, parsed.target, parsed.hex, request),
    `${parsed.target} ${parsed.color}`,
    { kind: "color", target: parsed.target, hex: parsed.hex, summary: `${parsed.target} ${parsed.color}` },
  );
}
