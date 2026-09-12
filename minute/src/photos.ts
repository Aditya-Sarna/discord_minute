import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export type ScratchPhotoTheme = "food" | "notes" | "finance" | "fashion" | "generic";

export type ScratchPhotos = {
  hero?: string;
  items: string[];
};

export type ScratchPhotoInput = {
  name: string;
  localPath?: string;
  url?: string;
};

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 8_000;
const MAX_PHOTOS = 5;

/** Curated Unsplash CDN stills — no API key. Fail soft if a host is down. */
const STOCK: Record<ScratchPhotoTheme, string[]> = {
  fashion: [
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1600&q=80",
    "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1594938291221-94d3ab31216c?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=80",
  ],
  food: [
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80",
  ],
  finance: [
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80",
  ],
  generic: [
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1400&q=80",
  ],
  notes: [],
};

export function stockPhotoUrls(theme: ScratchPhotoTheme): string[] {
  return STOCK[theme] ?? [];
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && Boolean(u.hostname) && !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

export function extractPhotoUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const cleaned = raw.replace(/[),.;]+$/g, "");
    let url: URL;
    try {
      url = new URL(cleaned);
    } catch {
      continue;
    }
    if (!isPublicHttpsUrl(url.href)) continue;
    const pathOk = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url.pathname);
    const hostOk = /(unsplash|pexels|picsum\.photos|imgur|cloudinary|googleusercontent|discordapp|discord)\./i.test(
      url.hostname,
    );
    if (pathOk || hostOk) out.push(url.href);
  }
  return out;
}

function neededCount(theme: ScratchPhotoTheme): number {
  if (theme === "notes") return 0;
  if (theme === "fashion") return 5;
  return 1;
}

/** Local stills when Unsplash is down — garment / plate / skyline shapes, not empty CSS swatches. */
export function fallbackStillSvg(theme: ScratchPhotoTheme, index: number): string {
  const palettes: Record<ScratchPhotoTheme, [string, string, string][]> = {
    fashion: [
      ["#1c1917", "#c4b6a6", "#f4efe6"],
      ["#2c2a28", "#d7c7b8", "#efe6d9"],
      ["#3f2e25", "#8b5e3c", "#f3e6d8"],
      ["#161412", "#5c4033", "#e8d5c4"],
      ["#292524", "#a8a29e", "#f5f5f4"],
    ],
    food: [["#9a3412", "#c2410c", "#fed7aa"]],
    finance: [["#042f2e", "#0f766e", "#99f6e4"]],
    generic: [["#0b1220", "#1e3a5f", "#93c5fd"]],
    notes: [["#1c1917", "#44403c", "#e7e5e4"]],
  };
  const [a, b, c] = palettes[theme][index % palettes[theme].length];
  const figure =
    theme === "food"
      ? `<ellipse cx="400" cy="620" rx="220" ry="70" fill="${c}" opacity="0.35"/>
  <ellipse cx="400" cy="520" rx="190" ry="190" fill="${c}" opacity="0.88"/>
  <ellipse cx="400" cy="500" rx="140" ry="140" fill="${b}"/>
  <ellipse cx="360" cy="470" rx="50" ry="40" fill="${c}" opacity="0.55"/>`
      : theme === "finance"
        ? `<rect x="180" y="280" width="90" height="420" fill="${c}" opacity="0.75"/>
  <rect x="300" y="200" width="110" height="500" fill="${c}" opacity="0.88"/>
  <rect x="440" y="320" width="80" height="380" fill="${c}" opacity="0.7"/>
  <rect x="550" y="250" width="100" height="450" fill="${c}" opacity="0.82"/>`
        : `<ellipse cx="400" cy="280" rx="88" ry="108" fill="${c}" opacity="0.9"/>
  <path d="M230 430 Q400 340 570 430 L610 920 L190 920 Z" fill="${c}" opacity="0.78"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
  <defs>
    <linearGradient id="g${index}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#g${index})"/>
  ${figure}
</svg>
`;
}

function fillFallbackStills(dir: string, theme: ScratchPhotoTheme, written: string[]): void {
  const need = neededCount(theme);
  while (written.length < need) {
    const file = `p${written.length}.svg`;
    writeFileSync(join(dir, file), fallbackStillSvg(theme, written.length));
    written.push(file);
  }
}

function extFrom(nameOrUrl: string, contentType?: string | null): string {
  const fromName = extname(nameOrUrl.split("?")[0] || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

function looksLikeImage(buf: Buffer, contentType?: string | null): boolean {
  if (buf.length < 24 || buf.length > MAX_BYTES) return false;
  const ct = (contentType || "").toLowerCase();
  if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return Boolean(ct.startsWith("image/"));
}

async function fetchPublicImage(url: string): Promise<{ buf: Buffer; contentType: string | null } | undefined> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpsUrl(current)) return undefined;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        signal: ac.signal,
        redirect: "manual",
        headers: { Accept: "image/*,*/*;q=0.8", "User-Agent": "Minute/0.1 (scratch photos)" },
      });
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return undefined;
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) return undefined;
    const contentType = res.headers.get("content-type");
    const buf = Buffer.from(await res.arrayBuffer());
    if (!looksLikeImage(buf, contentType)) return undefined;
    return { buf, contentType };
  }
  return undefined;
}

function webPath(file: string): string {
  return `/photos/${file}`;
}

export async function fetchScratchPhotos(
  root: string,
  opts: {
    theme: ScratchPhotoTheme;
    request?: string;
    attachments?: ScratchPhotoInput[];
    skipStock?: boolean;
  },
): Promise<ScratchPhotos> {
  const dir = join(root, "public", "photos");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  const takeLocal = (src: string, name: string) => {
    if (written.length >= MAX_PHOTOS) return;
    const file = `p${written.length}${extFrom(name)}`;
    try {
      copyFileSync(src, join(dir, file));
      written.push(file);
    } catch {
      // skip a bad attach
    }
  };

  for (const att of opts.attachments ?? []) {
    if (written.length >= MAX_PHOTOS) break;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(att.name) && !att.localPath) continue;
    if (att.localPath) takeLocal(att.localPath, att.name);
  }

  const urls = [
    ...extractPhotoUrls(opts.request || ""),
    ...(opts.skipStock ? [] : stockPhotoUrls(opts.theme)),
  ];
  const seen = new Set<string>();
  for (const url of urls) {
    if (written.length >= MAX_PHOTOS) break;
    if (seen.has(url)) continue;
    seen.add(url);
    const got = await fetchPublicImage(url);
    if (!got) continue;
    const file = `p${written.length}${extFrom(url, got.contentType)}`;
    writeFileSync(join(dir, file), got.buf);
    written.push(file);
  }

  const shouldFill = written.length === 0 || !opts.skipStock;
  if (shouldFill) fillFallbackStills(dir, opts.theme, written);

  if (!written.length) return { items: [] };
  return { hero: webPath(written[0]), items: written.slice(1).map(webPath) };
}
