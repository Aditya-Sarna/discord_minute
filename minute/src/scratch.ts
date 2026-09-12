import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScratchPhotos } from "./photos.js";
import type { Playground } from "./types.js";

export const PICK_TWEAK = "minute:pick:tweak";
export const PICK_SCRATCH = "minute:pick:scratch";
export const MODAL_SCRATCH = "minute:modal:scratch";

export type ScratchGithub = {
  owner: string;
  repo: string;
  defaultBranch: string;
};

export type ScratchIntent = {
  page: "login" | "checkout" | "notes" | "home";
  theme: "food" | "notes" | "finance" | "fashion" | "generic";
  brand: string;
  tagline: string;
  repoName: string;
};

export function looksLikeScratchAsk(text: string): boolean {
  return /\b(from scratch|new (github )?repo|new project|start a( new)? project|create a( new)? (repo|project|app|site|website))\b/i.test(
    text,
  );
}

function slug(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!s) s = "minute-project";
  if (!/^[a-z]/.test(s)) s = `m-${s}`;
  return s;
}

function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 40);
}

/** Never put the stakeholder's prompt on the page. Pull “called Ultra Pay” / quotes. */
export function extractBrand(request: string, explicitName?: string): string | undefined {
  if (explicitName?.trim()) return titleCase(explicitName);
  const quoted = request.match(/["“”']([^"'“”\n]{2,40})["“”']/);
  if (quoted?.[1]) return titleCase(quoted[1]);
  const called = request.match(/\b(?:called|named)\s+["“”']?([a-z0-9][a-z0-9 .&\-]{1,39})["“”']?/i);
  if (called?.[1]) return titleCase(called[1].replace(/[.,;:]+$/, ""));
  return undefined;
}

export function parseScratchIntent(request: string, explicitName?: string): ScratchIntent {
  const lower = (request || "").toLowerCase().replace(/\s+/g, " ").trim();
  const theme: ScratchIntent["theme"] = /\b(food|restaurant|bistro|dining|eat|delivery|kitchen|meal)\b/.test(lower)
    ? "food"
    : /\b(fashion|clothing|apparel|boutique|streetwear|couture|wardrobe)\b/.test(lower)
      ? "fashion"
      : /\b(note|notes|class|journal)\b/.test(lower)
        ? "notes"
        : /\b(finance|fintech|wallet|bank|banking|money|checkout|payment)\b/.test(lower)
          ? "finance"
          : "generic";
  const page: ScratchIntent["page"] = /\b(checkout|check out|cart|pay now|payment page)\b/.test(lower)
    ? "checkout"
    : /\b(login|log in|sign[ -]?in|sign[ -]?up|welcome back)\b/.test(lower)
      ? "login"
      : theme === "notes"
        ? "notes"
        : "home";
  const fromAsk = extractBrand(request, explicitName);
  const brand =
    fromAsk ||
    (theme === "food"
      ? "Plate"
      : theme === "notes"
        ? "Notes"
        : theme === "finance"
          ? "Pay"
          : theme === "fashion"
            ? "Atelier"
            : "Studio");
  const tagline =
    theme === "food"
      ? "Neighborhood kitchens, one tap away."
      : theme === "notes"
        ? "Write it down. Find it later."
        : theme === "finance"
          ? "Money that moves."
          : theme === "fashion"
            ? "Cut for the hour."
            : "Made to be used today.";
  const repoName = fromAsk
    ? slug(fromAsk)
    : theme === "food"
      ? "food-app"
      : theme === "notes"
        ? "notes"
        : theme === "finance"
          ? "pay-app"
          : theme === "fashion"
            ? "fashion-app"
            : slug(lower.replace(/\b(create|make|build|a|an|the|for|my|new|project|page|app|from|scratch|called|named)\b/g, " ")) ||
              "new-app";
  return { page, theme, brand, tagline, repoName };
}

export function scratchRepoName(ask: string, explicit?: string): string {
  return parseScratchIntent(ask, explicit).repoName;
}

function hasWord(hay: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay);
}

export function classifyScratch(
  request: string,
  playground: Playground,
): { ok: true; route: string; summary: string } | { ok: false; reason: string } {
  const lower = request.toLowerCase();
  const visualLogin = /\b(login|log in|sign[ -]?in|sign[ -]?up)\b/.test(lower);
  const visualCheckout = /\b(checkout|check out|cart|pay now|payment page)\b/.test(lower);
  const hard = ["oauth", "payments", "billing", "stripe", "kubernetes", "terraform", "secrets"];
  for (const topic of [...playground.refuse, ...hard]) {
    const t = topic.trim().toLowerCase();
    if (!t) continue;
    if ((t === "auth" || t === "authentication") && visualLogin) continue;
    if ((t === "payments" || t === "billing") && visualCheckout) continue;
    if (hasWord(lower, t)) {
      return {
        ok: false,
        reason: `A new project still can’t include ${t}. Ping tech for that — Minute will scaffold a simple site.`,
      };
    }
  }
  if (!request.trim()) {
    return { ok: false, reason: "Say what you want the new project to be." };
  }
  return { ok: true, route: "/", summary: request.trim().slice(0, 120) };
}

export function overlayScratchPlayground(base: Playground, github: ScratchGithub): Playground {
  return {
    ...base,
    github: {
      owner: github.owner,
      repo: github.repo,
      defaultBranch: github.defaultBranch || "main",
    },
    preview: {
      baseUrl: "",
      command: "node server.js",
      cwd: "",
      url: "http://127.0.0.1:3000",
      waitSeconds: 45,
      defaultRoute: "/",
      install: false,
      installTimeoutSeconds: 30,
    },
    allow: {
      paths: ["public/", "server.js", "package.json"],
      routes: ["/"],
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function serverJs(): string {
  return `const { createServer } = require("node:http");
const { readFileSync, existsSync, statSync } = require("node:fs");
const { extname, join } = require("node:path");
const port = Number(process.env.PORT || 3000);
const root = join(__dirname, "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
createServer((req, res) => {
  let rel = (req.url || "/").split("?")[0];
  try { rel = decodeURIComponent(rel); } catch { /* keep */ }
  if (rel === "/") rel = "/index.html";
  rel = rel.replace(/^\\/+/g, "");
  if (!rel || rel.includes("..") || rel.includes("\\\\")) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const file = join(root, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] || "text/plain; charset=utf-8" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1");
`;
}

function heroClass(photos?: ScratchPhotos): string {
  return photos?.hero ? "hero has-photo" : "hero";
}

function heroStyle(photos?: ScratchPhotos): string {
  return photos?.hero ? ` style="background-image:url('${escapeHtml(photos.hero)}')"` : "";
}

function foodLogin(brand: string, tagline: string, photos?: ScratchPhotos): { html: string; css: string; js: string } {
  const b = escapeHtml(brand);
  const t = escapeHtml(tagline);
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in · ${b}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="shell">
      <aside class="${heroClass(photos)}"${heroStyle(photos)}>
        <p class="mark">${b}</p>
        <h1>${t}</h1>
        <p>Order from kitchens near you. This is the door in.</p>
      </aside>
      <main class="panel">
        <h2>Welcome back</h2>
        <p class="lede">Sign in to ${b}.</p>
        <form id="login" novalidate>
          <label>Email
            <input type="email" name="email" autocomplete="username" placeholder="you@email.com" required />
          </label>
          <label>Password
            <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required />
          </label>
          <button type="submit">Sign in</button>
          <p class="hint">Demo screen — nothing is sent to a server.</p>
        </form>
        <p id="done" hidden>You’re in. This is a demo.</p>
      </main>
    </div>
    <script src="/app.js"></script>
  </body>
</html>
`,
    css: `:root { --ink: #1c1917; --paper: #fff7ed; --clay: #c2410c; --clay-dark: #9a3412; --muted: #78716c; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.shell { min-height: 100%; display: grid; grid-template-columns: 1.1fr 1fr; }
.hero { background: linear-gradient(160deg, #9a3412 0%, #c2410c 55%, #fb923c 100%); color: #fff7ed; padding: 4rem 3rem; display: flex; flex-direction: column; justify-content: flex-end; background-size: cover; background-position: center; position: relative; }
.hero.has-photo::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(28,25,23,0.2), rgba(28,25,23,0.62)); }
.hero.has-photo > * { position: relative; z-index: 1; }
.mark { letter-spacing: 0.2em; text-transform: uppercase; font-size: 0.78rem; margin: 0 0 1rem; opacity: 0.85; }
.hero h1 { font-size: 3rem; font-weight: 560; line-height: 1.1; margin: 0 0 1rem; max-width: 12ch; }
.hero p { margin: 0; max-width: 28ch; opacity: 0.9; }
.panel { padding: 4rem 3.2rem; display: flex; flex-direction: column; justify-content: center; background: #fffaf5; }
.panel h2 { margin: 0 0 0.4rem; font-size: 1.7rem; font-weight: 600; }
.lede { margin: 0 0 1.8rem; color: var(--muted); }
form { display: grid; gap: 1rem; max-width: 22rem; }
label { display: grid; gap: 0.35rem; font-size: 0.82rem; font-weight: 600; }
input { width: 100%; padding: 0.75rem 0.8rem; border: 1px solid #e7e5e4; border-radius: 10px; font: inherit; background: #fff; }
input:focus { outline: 2px solid var(--clay); border-color: transparent; }
button { margin-top: 0.4rem; border: 0; border-radius: 10px; padding: 0.85rem 1rem; background: var(--clay); color: #fff7ed; font: inherit; font-weight: 650; cursor: pointer; }
button:hover { background: var(--clay-dark); }
.hint, #done { color: var(--muted); font-size: 0.82rem; }
#done { color: var(--clay-dark); font-weight: 600; }
@media (max-width: 800px) {
  .shell { grid-template-columns: 1fr; }
  .hero { min-height: 16rem; padding: 2rem 1.4rem; }
  .hero h1 { font-size: 2rem; }
  .panel { padding: 2rem 1.4rem 3rem; }
}
`,
    js: `const form = document.getElementById("login");
const done = document.getElementById("done");
form?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (done) done.hidden = false;
});
`,
  };
}

function genericLogin(brand: string, tagline: string, photos?: ScratchPhotos): { html: string; css: string; js: string } {
  const food = foodLogin(brand, tagline, photos);
  return {
    ...food,
    css: food.css
      .replace("#9a3412", "#1e3a8a")
      .replace("#c2410c", "#1d4ed8")
      .replace("#fb923c", "#60a5fa")
      .replace(/--clay: #c2410c/, "--clay: #1d4ed8")
      .replace(/--clay-dark: #9a3412/, "--clay-dark: #1e3a8a")
      .replace("#fff7ed", "#f8fafc")
      .replace("#fffaf5", "#ffffff"),
  };
}

function notesPage(brand: string, tagline: string): { html: string; css: string; js: string } {
  const b = escapeHtml(brand);
  const t = escapeHtml(tagline);
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${b}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header>
      <p class="mark">${b}</p>
      <h1>${t}</h1>
    </header>
    <main>
      <textarea id="pad" placeholder="Write a note…"></textarea>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`,
    css: `body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f4f1ea; color: #1a1814; }
header, main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.4rem; }
.mark { letter-spacing: 0.16em; text-transform: uppercase; font-size: 0.75rem; color: #8b8680; }
h1 { font-size: 2rem; font-weight: 560; margin: 0.3rem 0 0; }
textarea { width: 100%; min-height: 16rem; border: 1px solid #e4e0d6; border-radius: 12px; padding: 1rem; font: inherit; background: #fff; }
`,
    js: `const pad = document.getElementById("pad");
if (pad) pad.value = localStorage.getItem("minute-notes") || "";
pad?.addEventListener("input", () => localStorage.setItem("minute-notes", pad.value));
`,
  };
}

function financeCheckout(brand: string, tagline: string, photos?: ScratchPhotos): { html: string; css: string; js: string } {
  const b = escapeHtml(brand);
  const t = escapeHtml(tagline);
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Checkout · ${b}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="shell">
      <aside class="${heroClass(photos)}"${heroStyle(photos)}>
        <p class="mark">${b}</p>
        <p class="eyebrow">Checkout</p>
        <h1>${t}</h1>
        <div class="sum">
          <div><span>Send to</span><strong>Maya Chen</strong></div>
          <div><span>For</span><strong>June rent share</strong></div>
          <div class="total"><span>Total</span><strong>$48.00</strong></div>
        </div>
      </aside>
      <main class="panel">
        <h2>Pay with card</h2>
        <p class="lede">Demo checkout — nothing is charged.</p>
        <form id="pay" novalidate>
          <label>Card number
            <input inputmode="numeric" autocomplete="cc-number" placeholder="ACCT-000015" maxlength="19" />
          </label>
          <div class="row">
            <label>Expiry
              <input autocomplete="cc-exp" placeholder="MM / YY" maxlength="7" />
            </label>
            <label>CVC
              <input inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" />
            </label>
          </div>
          <label>Name on card
            <input autocomplete="cc-name" placeholder="Your name" />
          </label>
          <button type="submit">Pay $48.00</button>
        </form>
        <p id="done" hidden>Paid — this is a demo. No money moved.</p>
      </main>
    </div>
    <script src="/app.js"></script>
  </body>
</html>
`,
    css: `:root { --ink: #06251f; --paper: #f3faf7; --mint: #0f766e; --mint-dark: #115e59; --muted: #5b6b67; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font-family: "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.shell { min-height: 100%; display: grid; grid-template-columns: 1fr 1.05fr; }
.hero { background: linear-gradient(165deg, #042f2e 0%, #0f766e 70%, #2dd4bf 100%); color: #ecfdf5; padding: 3.4rem 2.8rem; display: flex; flex-direction: column; justify-content: flex-end; background-size: cover; background-position: center; position: relative; }
.hero.has-photo::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(4,47,46,0.25), rgba(4,47,46,0.7)); }
.hero.has-photo > * { position: relative; z-index: 1; }
.mark { letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.78rem; margin: 0; opacity: 0.8; }
.eyebrow { margin: 2rem 0 0.4rem; font-size: 0.82rem; opacity: 0.75; }
.hero h1 { font-size: 2.4rem; font-weight: 560; line-height: 1.15; margin: 0 0 2rem; max-width: 14ch; }
.sum { display: grid; gap: 0.75rem; max-width: 18rem; }
.sum div { display: flex; justify-content: space-between; gap: 1rem; font-size: 0.95rem; }
.sum span { opacity: 0.75; }
.total { padding-top: 0.6rem; border-top: 1px solid rgba(236,253,245,0.25); font-size: 1.15rem; }
.panel { padding: 3.6rem 3rem; display: flex; flex-direction: column; justify-content: center; background: #fff; }
.panel h2 { margin: 0 0 0.35rem; font-size: 1.55rem; }
.lede { margin: 0 0 1.6rem; color: var(--muted); }
form { display: grid; gap: 0.9rem; max-width: 24rem; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
label { display: grid; gap: 0.35rem; font-size: 0.8rem; font-weight: 650; }
input { width: 100%; padding: 0.75rem 0.8rem; border: 1px solid #d7e3df; border-radius: 10px; font: inherit; background: #f8fffc; }
input:focus { outline: 2px solid var(--mint); border-color: transparent; }
button { margin-top: 0.35rem; border: 0; border-radius: 10px; padding: 0.9rem 1rem; background: var(--mint); color: #ecfdf5; font: inherit; font-weight: 650; cursor: pointer; }
button:hover { background: var(--mint-dark); }
#done { color: var(--mint-dark); font-weight: 600; }
@media (max-width: 800px) {
  .shell { grid-template-columns: 1fr; }
  .hero { min-height: 18rem; padding: 2rem 1.4rem; }
  .panel { padding: 2rem 1.4rem 3rem; }
}
`,
    js: `const form = document.getElementById("pay");
const done = document.getElementById("done");
form?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (done) done.hidden = false;
});
`,
  };
}

function productShot(src: string | undefined, title: string, fallback: string): string {
  if (src) return `<img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" />`;
  return `<div class="swatch ${fallback}"></div>`;
}

function fashionHome(brand: string, tagline: string, photos?: ScratchPhotos): { html: string; css: string; js: string } {
  const b = escapeHtml(brand);
  const t = escapeHtml(tagline);
  const items = photos?.items ?? [];
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${b}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <nav>
      <a class="logo">${b}</a>
      <div class="links"><span>New</span><span>Women</span><span>Men</span><span>Archive</span></div>
      <span class="bag">Bag 0</span>
    </nav>
    <section class="${heroClass(photos)}"${heroStyle(photos)}>
      <p class="season">Spring 26</p>
      <h1>${t}</h1>
      <p>Wool and silk, cut close. Made to be lived in.</p>
      <button type="button">Shop the drop</button>
    </section>
    <section class="rail">
      <p class="kicker">New in</p>
      <div class="grid">
        <article>${productShot(items[0], "Silk slip", "a")}<h3>Silk slip</h3><p>$240</p></article>
        <article>${productShot(items[1], "Wool coat", "b")}<h3>Wool coat</h3><p>$620</p></article>
        <article>${productShot(items[2], "Evening trouser", "c")}<h3>Evening trouser</h3><p>$380</p></article>
        <article>${productShot(items[3], "Knit tank", "d")}<h3>Knit tank</h3><p>$160</p></article>
      </div>
    </section>
    <footer>${b} · New York · Paris</footer>
    <script src="/app.js"></script>
  </body>
</html>
`,
    css: `* { box-sizing: border-box; }
html, body { margin: 0; background: #f4efe6; color: #161412; }
body { font-family: "Iowan Old Style", Palatino, "Times New Roman", serif; }
nav { display: flex; align-items: center; justify-content: space-between; padding: 1.1rem 2.2rem; background: #111; color: #f4efe6; }
.logo { font-size: 1.15rem; letter-spacing: 0.28em; text-transform: uppercase; text-decoration: none; color: inherit; font-weight: 600; }
.links { display: flex; gap: 1.6rem; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
.bag { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; }
.hero { min-height: 58vh; padding: 5rem 2.2rem 4rem; background: #1c1917; color: #f4efe6; background-size: cover; background-position: center; position: relative; }
.hero.has-photo::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(22,20,18,0.15), rgba(22,20,18,0.62)); }
.hero.has-photo > * { position: relative; z-index: 1; }
.season { letter-spacing: 0.22em; text-transform: uppercase; font-size: 0.72rem; margin: 0 0 1rem; opacity: 0.65; }
.hero h1 { font-size: clamp(3rem, 8vw, 6rem); font-weight: 400; line-height: 0.95; margin: 0 0 1rem; max-width: 12ch; }
.hero p { max-width: 28ch; margin: 0 0 1.8rem; font-size: 1.15rem; opacity: 0.82; }
.hero button { border: 1px solid #f4efe6; background: transparent; color: #f4efe6; padding: 0.8rem 1.4rem; letter-spacing: 0.12em; text-transform: uppercase; font: inherit; font-size: 0.75rem; cursor: pointer; }
.rail { padding: 2.4rem 2.2rem 3.4rem; }
.kicker { letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.72rem; margin: 0 0 1.2rem; color: #6b645b; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
.grid img, .swatch { width: 100%; height: 16rem; object-fit: cover; display: block; margin-bottom: 0.7rem; background: #ddd; }
.swatch.a { background: #c4b6a6; }
.swatch.b { background: #2c2a28; }
.swatch.c { background: #5c4033; }
.swatch.d { background: #d7c7b8; }
article h3 { margin: 0; font-size: 1.05rem; font-weight: 500; }
article p { margin: 0.2rem 0 0; color: #6b645b; }
footer { padding: 1.2rem 2.2rem 2rem; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: #6b645b; }
@media (max-width: 800px) {
  .links { display: none; }
  .hero { min-height: 42vh; padding: 3rem 1.3rem; }
  .grid { grid-template-columns: 1fr 1fr; }
  .rail, nav, footer { padding-left: 1.3rem; padding-right: 1.3rem; }
}
`,
    js: `document.querySelector(".hero button")?.addEventListener("click", () => {
  document.querySelector(".rail")?.scrollIntoView({ behavior: "smooth" });
});
`,
  };
}

function productHome(brand: string, tagline: string, photos?: ScratchPhotos): { html: string; css: string; js: string } {
  const b = escapeHtml(brand);
  const t = escapeHtml(tagline);
  const shot = photos?.hero
    ? `<figure class="shot"><img src="${escapeHtml(photos.hero)}" alt="" /></figure>`
    : "";
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${b}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <nav>
      <strong>${b}</strong>
      <div><span>Product</span><span>Pricing</span><span>Sign in</span></div>
    </nav>
    <section class="hero">
      <div>
        <h1>${t}</h1>
        <p>A working first screen for ${b}. Not a prompt pasted on a page.</p>
        <button type="button">Get started</button>
      </div>
      ${shot}
    </section>
    <section class="cards">
      <article><h3>Fast</h3><p>Open it and see the thing, not a placeholder.</p></article>
      <article><h3>Clear</h3><p>Copy and layout you can argue with in the thread.</p></article>
      <article><h3>Yours</h3><p>Reply to change color, type, or the name on the door.</p></article>
    </section>
    <script src="/app.js"></script>
  </body>
</html>
`,
    css: `* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #0b1220; color: #e8eef8; }
nav { display: flex; justify-content: space-between; padding: 1.2rem 2rem; }
nav div { display: flex; gap: 1.4rem; opacity: 0.7; font-size: 0.9rem; }
.hero { padding: 5rem 2rem 3rem; max-width: 72rem; display: grid; grid-template-columns: minmax(16rem, 28rem) minmax(0, 1fr); gap: 2rem; align-items: center; }
.hero h1 { font-size: clamp(2.4rem, 6vw, 4.2rem); line-height: 1.05; margin: 0 0 1rem; font-weight: 560; }
.hero p { margin: 0 0 1.6rem; opacity: 0.75; max-width: 34ch; }
.shot { margin: 0; }
.shot img { width: 100%; max-height: 22rem; object-fit: cover; border-radius: 18px; display: block; }
button { border: 0; border-radius: 999px; padding: 0.8rem 1.3rem; background: #e8eef8; color: #0b1220; font: inherit; font-weight: 650; cursor: pointer; }
@media (max-width: 800px) {
  .hero { grid-template-columns: 1fr; padding-top: 3rem; }
}
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; padding: 0 2rem 4rem; }
article { background: #141c2e; border-radius: 16px; padding: 1.3rem; }
article h3 { margin: 0 0 0.4rem; }
article p { margin: 0; opacity: 0.7; }
@media (max-width: 800px) {
  .cards { grid-template-columns: 1fr; }
}
`,
    js: `document.documentElement.dataset.app = "home";\n`,
  };
}

/** First photo must look like the ask. Do not wait on a 7B “smallest change”. */
export function writeScratchApp(
  root: string,
  request: string,
  explicitName?: string,
  opts?: { photos?: ScratchPhotos },
): { files: string[]; summary: string; routeHint: string } {
  const intent = parseScratchIntent(request, explicitName);
  const photos = opts?.photos;
  const built =
    intent.page === "checkout"
      ? financeCheckout(intent.brand, intent.tagline, photos)
      : intent.page === "login" && intent.theme === "food"
        ? foodLogin(intent.brand, intent.tagline, photos)
        : intent.page === "login"
          ? genericLogin(intent.brand, intent.tagline, photos)
          : intent.page === "notes"
            ? notesPage(intent.brand, intent.tagline)
            : intent.theme === "fashion"
              ? fashionHome(intent.brand, intent.tagline, photos)
              : productHome(intent.brand, intent.tagline, photos);

  mkdirSync(join(root, "public"), { recursive: true });
  const files: Array<[string, string]> = [
    [
      "package.json",
      `${JSON.stringify({ name: intent.repoName, private: true, scripts: { start: "node server.js" } }, null, 2)}\n`,
    ],
    ["server.js", serverJs()],
    ["public/index.html", built.html],
    ["public/styles.css", built.css],
    ["public/app.js", built.js],
  ];
  const written: string[] = [];
  for (const [rel, body] of files) {
    const dest = join(root, rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, body);
    written.push(rel);
  }
  const photoDir = join(root, "public", "photos");
  if (existsSync(photoDir)) {
    for (const name of readdirSync(photoDir)) {
      written.push(`public/photos/${name}`);
    }
  }
  const summary =
    intent.page === "login"
      ? `${intent.brand} sign-in`
      : intent.page === "checkout"
        ? `${intent.brand} checkout`
        : intent.page === "notes"
          ? `${intent.brand} notes`
          : `${intent.brand} ${intent.theme === "fashion" ? "store" : "home"}`;
  return { files: written, summary, routeHint: "/" };
}

/** @deprecated use writeScratchApp — kept for older tests */
export function writeScratchScaffold(root: string, opts: { title: string; blurb: string }): string[] {
  return writeScratchApp(root, opts.blurb || opts.title, opts.title).files;
}
