# Minute — first principles

What would make this a **production-grade hero product** at startup level.

This is the bar. Features below only earn a place if they make the handoff thinner. Everything else is inventory.

---

## 1. The job

A person who does not know git has a visual intent.

A person who owns the system must not hold that intent in their head.

Minute’s job is to make that handoff **thin**:

```
intent (chat)
  → smallest change on a real branch
  → photo of the running thing
  → iterate in the same thread
  → “looks good”
  → tech reviews a PR that describes the change, not the chat
```

If the ask is architecture, auth, payments, or a rewrite: **stop**. Humans talk. Tech edits the PR by hand.

That stop is a product feature, not a failure.

---

## 2. Irreducible truths

These do not change with Slack, email, a bigger model, or a nicer dashboard.

### The photo is the spec

The stakeholder never owes anyone a ticket, a Figma, or a “requirements doc.” The after-shot *is* what they asked for. If the photo is wrong, the product is wrong — even if the PR is technically clean.

A 10 here means: every successful run posts a photo of **this branch**, not staging, not a mock, not a CSS swatch pretending to be a store.

### Git stays on the tech side

The requester never sees clone, branch, conflict, or rebase. They see a thread and a picture. Tech sees a PR whose title and body were rewritten from `git diff`. If tech has to reconstruct intent from Discord scrollback, Minute failed.

### Smallest change, allowlisted paths

Minute is not an agent that “builds the app.” It is a constrained editor inside rails tech drew once (`allow.paths`, `refuse`, one channel → one repo). Crossing those rails is a bug, not ambition.

### Refuse is more valuable than try

A polite stop (“this is auth — talk to tech”) is a hero moment. A sloppy login page from a 7B is a trust-killer. Production Minute would rather exit than invent.

### Same conversation, same object

Start, photo, “a bit darker,” Looks good — one thread, one run, one PR. A second surface, a dashboard, or a web app that splits that object is not the product. It is an operator radio.

### Latency is part of the sentence

“On it” then a photo in the time a person would wait in chat. If they context-switch, Minute is a batch job with a Discord skin.

---

## 3. What “hero” means here

Hero is not “AI that codes.” Hero is **the first photo that matches what they meant**.

The wedge is one office, one Discord channel, one playground repo, three roles:

| Role | Owns | Never owns |
|---|---|---|
| Stakeholder | Intent, sign-off | Git, deploy, architecture |
| Minute | Smallest visual change + proof | Judgment that the system is safe |
| Tech | Rails, review, merge | Translating “make the header green” into CSS |

A startup-level hero product is the one a non-technical person **reuses without being trained**, and that tech **does not disable** after the first bad PR.

Reuse without training means:

- They type like a human. No slash grammar required (slash is a shortcut).
- The first reply is a status they understand (“Fetching photos…”, “Taking a photo…”), not a stack trace.
- The second reply is a picture. Not a file tree. Not “I updated `index.css`.”
- Iterate is a reply. Not a new `/minute`. Not “open the dashboard.”

Tech does not disable it means:

- Every commit is reviewable and revertible.
- Secrets, auth, billing, infra never appear in the diff.
- The bot has an identity (GitHub App or bot user), not a founder’s PAT in `.env`.
- When it cannot do the thing, it says so in one sentence and stops.

---

## 4. Production-grade (the unglamorous half)

A hero demo that dies when the laptop sleeps is a prototype. Production-grade Minute is boring in the right places.

### Trust

- **Identity:** GitHub App (installation token), not a personal PAT. Installation is per-org. Revoke is one click.
- **Authz:** Allowlist is the product. Admins grant in Discord. No “anyone in the server.” No implicit email leftover.
- **Secrets:** Token never in clone URLs, never in logs, never in PR bodies. Redact by default.
- **Blast radius:** One job, one workspace, prune on exit. Cap files, bytes, iterations, concurrent jobs. SSRF-safe downloads only.
- **Stop conditions:** Classify refuse, preview 404, empty diff, model slop — all exit into English, not a half-merged branch.

### Reliability

- `/ready` is the contract: Discord connected, Message Content on, GitHub can write, LLM up, Chromium can launch. If any of those are false, do not pretend to take photos.
- Preview ready means **HTTP 200 of the app**, not “port is open,” not a compile splash, not a 404 card.
- Jobs survive process restart. Stuck jobs recover. SIGTERM drains.
- Photos are not optional in the happy path. If Playwright is missing, `/ready` is red and the stakeholder is told — not given a white rectangle.

### Operability

- One process for the product (the Discord bot). A dashboard is optional and never on the stakeholder path.
- One LLM backend you would sell: a frontier coder with a local fallback, not a 7B as the ceiling you advertise.
- Config is drawn once by tech (channel → repo → allow → refuse). Changing rails is a tech act, not a chat act.
- Multi-tenant later: workspace = org + installation + playgrounds. Do not fake this with a second Slack adapter.

### The photo pipeline is a product, not a script

1. Branch exists and was just edited.
2. Deps install with a timeout.
3. Dev server is actually serving the route.
4. Desktop + phone frames, stable, no cookie banners, no “Not found.”
5. Image lands on the proof card in-thread.

If step 3 fails, say so. Do not post a screenshot of the failure and call it a proof.

---

## 5. Startup-level (what you would raise or sell)

First principles of the company, not the repo.

### Who pays

Tech pays (or the office that owns the repo). The stakeholder is the user; they do not have a budget line. Sell **hours of translation deleted** — the PM/designer/teacher no longer writes a ticket, and the engineer no longer sits in a huddle to learn what “warmer” means.

If you cannot name the buyer in one office, you do not have a startup. You have a bot you run for yourself.

### The wedge is shamefully narrow

Do **not** start as “AI for every chat surface.” Start as:

> In this Discord channel, visual tweaks to this repo come back as a photo, then a PR.

Win that loop so hard that adding Slack is a distribution choice, not a rewrite. Surfaces you do not run are not a roadmap. They are a lie.

### Three loops, in this order

1. **Tweak** — color, type, hide, copy, “a bit darker.” Deterministic when the ask is simple; model only when rails are not enough. This is the money loop.
2. **Scratch** — new private repo from a real first screen (login, checkout, home), with real stills, then the same tweak loop. This is the wow for people with no playground yet.
3. **Ask** — paste a GitHub URL, get a human walkthrough with file pointers. This is a trust loop for tech. It must never dump a file catalog.

Anything else (dashboard, email, WhatsApp, “full app builder”) waits until 1 is boringly reliable.

### The model is a means

The product is the loop, not the weights. A 7B on a laptop is an honest office constraint. It is not a startup ceiling. Production Minute uses a model that can:

- do one unique search/replace without inventing paths
- refuse instead of slop
- walk a repo in pointers, not inventories

If the model cannot do that, **do not send the ask to the model.** Deterministic edits and templates are not a downgrade. They are how you stay a hero while the model is weak.

### Moat

There is no moat in “we called an LLM.” The moat is:

- rails tech already drew (allow/refuse/preview)
- a photo pipeline that is right every time
- a PR a senior will merge
- a thread a non-technical person will use again on Tuesday

That is workflow lock-in. It only exists if Tuesday works.

### What not to build

- A web app where stakeholders “manage runs.”
- A second chat product before Discord is a 10 in the field.
- General coding agent / “replace the intern.”
- Auto-merge from chat. Tech’s review is the product. Auto-merge is how you get banned from the org.
- Inventory answers, prompt-as-H1, swatch-as-photo, 404-as-proof. Each of those is a churn event.

---

## 6. The field test (you are not a 10 until this is true)

Pick a person who is not you. They have never seen the repo.

1. They open the wired Discord channel.
2. They say, in English, “make the header forest green.”
3. Under two minutes they get a photo of a green header on the running app.
4. They reply “a bit darker.”
5. They get a second photo. Same thread. Same PR, updated.
6. They click Looks good. Tech is pinged. The PR body describes the darker header.
7. Tech can merge without asking what they meant.

Then, same person, different day:

8. “Start a new project, a fashion site called Mo.”
9. First photo is a store, not a 404, not four color tiles.
10. They paste a GitHub URL and ask how checkout works. The answer is **Start here / Follow / The idea**, with real paths — not a function list.

If any step needs you in the thread, it is not production-grade. If it only works on your Mac while it is awake, it is not a startup.

---

## 7. Honest present tense

As of this writing Minute is a **strong office Discord loop**, not a hero startup product.

True:

- One surface (Discord). One thread. Photo + PR. Looks good pings tech.
- Rails: allow paths, refuse list, rate limits, job queue, `/ready`.
- Spoken tweaks skip the 7B: color, darker/lighter/warmer, hide/show, type size, “say X”, left/more space, “do that to the footer too.”
- Undo (button or “undo that”) reverts the last Minute commit on the feature branch. Empty diff exits in English. Proof card shows tweaks left + Undo.
- “Show me mobile” restamps the phone frame. Cookie/banner dismiss before the shot.
- Ask: “show me src/foo.ts” posts a snippet; “where would this live?” points at a file. No edit on ask.
- Scratch templates exist; stills fall back if stock photos fail.
- Repo Q&A can speak in pointers.

Not true, and therefore not a 10:

- The live model is a local 7B. Compound asks slop.
- Scratch is five templates, not a general first product.
- Ask was a catalog in the field once; that is the last live evidence.
- Identity is a PAT. Process dies if the laptop sleeps. Dual stack (bot + optional dashboard) is extra moving parts.
- No second office has reused this without the author in the loop.

Do not sell the inventory. Sell the loop — after the field test passes for someone else.

---

## 8. The only sequence that gets you there

1. **Make the tweak loop boring.** Forest green, darker, bigger type, hide the badge — photo every time, PR every time, refuse when it is not visual. No 7B required for those sentences.
2. **Make the photo pipeline a contract.** Chromium always there. 404 is not ready. First scratch photo is a real screen.
3. **Put a real coder model behind the rails** for the asks that are still simple but not regex. Keep refuse.
4. **Ship as a GitHub App + hosted worker** so it is not a Mac process. One region, one SQLite or Postgres, drain on deploy.
5. **Run the field test with a stranger.** Fix only what they hit.
6. **Then** talk about a second workspace, a second surface, or a price.

Until step 5 is true, more surfaces make you less of a product.

---

## 9. Features that earn a place

Each item is a sentence a stranger could say, or a guarantee tech can keep. If it does not serve a principle in §2, it does not ship.

### Tweak — the money loop

These are the asks that must never wait on a 7B.

| They say | Minute does |
|---|---|
| “Make the header forest green” | Paint. Photo. |
| “A bit darker” / “warmer” / “less loud” | Shift the last color on the same target. Same PR. |
| “Bigger type” / “smaller type” | Font-size on the thing they meant (header, body, button). |
| “Hide the badge” / “take that bar off” | `display: none` on the named piece. |
| “Say Welcome back instead” | Replace the visible copy. Never invent a new page. |
| “Left side” / “more space under the title” | One layout nudge (padding, align). Refuse if it is a redesign. |
| “Only the homepage” / “everywhere” | Route chip, then photo of that route. |
| “Undo that” | Revert the last commit on the branch. New photo of the prior state. |
| “Show me mobile” | Phone frame of the same route, no new ask. |
| “Do that to the footer too” | Repeat the last successful op on a second target. |
| “Match this” *(drops a PNG)* | Sample color/type from the mock; apply inside allow.paths. |
| “Read this as spec” *(drops a PDF)* | Extract the visual asks; run them one at a time with a photo each. |
| “Put this logo in” | Place the asset on the allowlisted path; photo proves it. |

**Thread features that keep the spec in one place**

- **Before / after on one card.** Stakeholder sees what changed without scrolling.
- **Circle the change.** A light crop or mark on the after-shot so “darker” is obvious.
- **Latest photo is the spec.** Pin or restamp so the thread’s truth is the last frame, not message 40.
- **Budget in English.** “3 of 8 tweaks left” — not a job id.
- **Undo and Looks good on every proof.** Cancel still kills the run.
- **Empty diff exits.** “I didn’t change anything” — no fake photo.
- **Two options when the ask is ambiguous.** “Green like this, or this?” Two photos, they pick. One PR.

### Scratch — first screen, then the same loop

Not a general app builder. A first *real* screen, then tweak.

- **Named brand.** “Called Mo” / quotes become the H1. The prompt never becomes the headline.
- **Theme from the sentence.** Food, fashion, finance, notes, generic — plus **logo-drop brand** (colors from the attached mark).
- **First photo is a store / login / checkout / notes page.** Unsplash, then attached stills, then local stills. Never four empty tiles. Never 404.
- **Multi-page only as a chain.** “Add a notes tab” after the home exists — same PR, new photo. Not five pages from one paragraph.
- **Private repo, English name.** They never type a slug. Tech can rename later.
- **Same iterate as tweak.** Darker, bigger type, hide, swap the hero still — no second product.

### Ask — trust for tech, readable for humans

- **Paste a GitHub URL + a question.** Shallow clone, ranked files, pointer answer: **What this is / Start here / Follow / The idea**.
- **Follow-ups reuse the clone.** New URL reclones. Same thread.
- **Refuse the catalog.** If the model emits Function:/File: lists, throw it away and walk again or stop.
- **“Show me that file”** — a short cited snippet in-thread, not a zip.
- **“Where would this change live?”** — pointer to the file they would allowlist. Minute does not edit on an Ask run unless they switch to tweak.

### Handoff — git stays on the tech side

- **Looks good → tech is pinged.** Mentions from config, not “@everyone.”
- **PR title/body from the diff.** Rewritten after every iterate. Chat diary never pasted.
- **After-shot on the PR.** Tech reviews the same photo the stakeholder signed.
- **Changes requested / closed** come back as one English line in the thread. Minute exits. Humans talk.
- **Hand to a different reviewer.** Admin: “ping Jordan instead.” Same PR.
- **Queue while tech is out.** Stakeholder still signs off; tech gets one digest, not twelve pings.
- **Never auto-merge from chat.** Review is the product.

### Photo pipeline — the spec machine

- Desktop + phone every successful tweak.
- Wait for the **real route** (200 + not a compile splash, not a 404).
- Dismiss cookie/banner once per playground so the shot is the app.
- Optional **hover / open-menu** second frame when the ask is about a control.
- Optional **light + dark** pair when the playground has both.
- Visual diff vs last merge: a third strip that is the delta, for tech.
- If Chromium is down, `/ready` is red and the thread is told. No white rectangle.

### Rails tech draws once (in Discord, for tech only)

- `/minute-admin` : who may ask, who is tech, which channel → which repo.
- **Playground wizard for tech:** paste the repo, pick the channel, confirm allow.paths from a tree, set refuse, set the preview command. Stakeholder never sees this.
- **Logged-in preview user** (cookie/storage tech supplies) so shots of app pages are not the marketing splash.
- **Second playground = second channel.** Never two repos fighting in one thread.
- Grant / revoke a person in one sentence. Overlay persists across restarts.

### Production (so Tuesday works without your Mac)

- **GitHub App.** Per-org install. Revoke is one click. No founder PAT.
- **Hosted worker.** Queue, drain, one region. Laptop sleep is not an outage.
- **`/ready` as the contract.** Discord, Message Content, GitHub write, LLM, Chromium.
- **One job, one workspace, prune on exit.** Caps on files, bytes, iterates, concurrency.
- **SSRF-safe** fetches for stills and attachments. HTTPS, no private hosts.
- **Audit for tech.** Who asked, what changed, which photo, which SHA — in the PR, not a stakeholder dashboard.
- **Cost line per office.** Tokens + minutes of preview, visible to the buyer, not the requester.
- **Sandbox the preview.** The running app cannot reach the bot’s secrets.

### Startup (after the field test, not before)

- **Install:** Discord App + GitHub App. Tech finishes rails in one sitting.
- **Price the deleted huddle.** Per playground / per successful signed-off PR — not per seat of people who only type “darker.”
- **Second office without the author.** That is the real v1.
- **Slack as a port of the same object** (run, photo, PR) — only after Discord is boring. Not a rewrite.
- **Marketplace listing** that promises the field test, not “AI coding.”

### Spoken product (deterministic first)

Ship these as parsers before they ever hit a model:

1. Color + named target  
2. Darker / lighter / warmer / cooler (relative to last paint)  
3. Bigger / smaller type  
4. Hide / show a named piece  
5. Replace visible copy (“say X”)  
6. Undo  
7. Homepage vs everywhere  
8. Match this / read as spec / put in the repo (chips on a silent drop)

The model is for the leftover that is still *small* and still *visual*. If it is not, refuse.

---

## 10. Features that do not earn a place

Write these down so they do not sneak back in as “roadmap.”

- Stakeholder web app / “my runs” dashboard  
- Auto-merge from Looks good  
- General coding agent, refactors, new auth, payments, infra  
- Prompt-as-H1, swatch-as-hero, 404-as-proof, file-catalog answers  
- WhatsApp / email / a second bot personality  
- “Build me the whole product from this paragraph”  
- Anything that makes the requester see git  

If a new idea is not in §9 and not forbidden here, it still has to pass §2 before it is a ticket.
