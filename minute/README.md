# Minute

A Slack bot that makes the handoff between non-tech people and engineering **thin**.

Someone who does not know git asks for a simple thing. Minute puts a photo of the change in **the same conversation**. They iterate there. When they are satisfied they ping tech. Tech reviews the **PR on technical grounds**. Git stays on the tech side.

If it is not architecturally feasible, Minute **stops**. Humans talk. Tech improves the PR by hand.

## What it is for

Simple work that still has to live in the repo: a color, copy, a notes tab, dropping a chart onto a page. Not architecture, auth, payments, or a redesign.

- **Stakeholder** owns intent. The photo is the spec.
- **Tech** owns the system. They never have to hold “what the teacher wants the tab to look like.”

## Loop

```
/minute make a notes tab for my class
        ↓
same thread: working → photo
        ↓
reply to tweak (“bigger type”, “left side”)
        ↓
Looks good  →  tech is pinged with the PR
        ↓
tech reviews the PR (not in Minute)
        ↓
approve  or  disapprove (Minute exits; talk + fix the PR)
```

## Setup

Node 22+. A GitHub repo. An Anthropic or OpenAI key.

```bash
cd minute
cp .env.example .env
# fill .env
cp minute.config.yaml minute.config.yaml  # edit playgrounds, admins, tech
npm install
npx playwright install chromium
npm start
```

### 1. Config — tech draws the playground once

Edit `minute.config.yaml`:

- **admins** — can `/minute-admin allow @person`
- **requesters** — selected employees who may run `/minute` (admins can grant more in chat)
- **tech** — who gets pinged on sign-off
- **playgrounds** — one Slack channel → one repo, allowed paths/routes, refuse list, preview

Channel and member IDs:

- Channel: open the channel → About → copy the id (`C…`) into `slackChannelIds`
- Member: profile → Copy member ID (`U…`) into `slackUserIds` for admins, requesters, and tech

### 2. Slack

Socket Mode, so the bot does not need a public URL.

1. [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. Socket Mode → enable → generate an app-level token with `connections:write` → `SLACK_APP_TOKEN` (`xapp-`)
3. OAuth & Permissions → Bot Token Scopes: `chat:write`, `commands`, `files:write`, `files:read`, `channels:history`, `groups:history`, `app_mentions:read`, `users:read` → install to the workspace → `SLACK_BOT_TOKEN` (`xoxb-`)
4. Basic Information → Signing Secret → `SLACK_SIGNING_SECRET`
5. Slash Commands → `/minute` and `/minute-admin` (the request is the command text, for example `/minute make the header green`; `/minute-admin allow U0123`)
6. Event Subscriptions → enable, subscribe to bot events `app_mention`, `message.channels`, `message.groups`
7. Invite the app into the playground channel

Put those three tokens in `.env`, and the Slack ids in `minute.config.yaml`, then `npm start`.

### 3. GitHub

A PAT or GitHub App token with `repo` (clone, push, open PRs). `GITHUB_TOKEN` in `.env`.

The token’s user needs write access to the playground repo.

### 4. Photos

```yaml
preview:
  baseUrl: https://staging.example.com
  command: npm run dev
  url: http://localhost:3000
  waitSeconds: 45
  defaultRoute: /
  install: true
```

Minute installs repo deps (`npm ci` / `npm install`) before `command`, then screenshots the running app. If `command` is empty, it still opens the PR and says it could not take a live photo.

## Production

- SQLite in `MINUTE_DATA_DIR` (runs, jobs, access, rate limits)
- Job worker (`MINUTE_MAX_JOBS`, default 2) with restart recovery
- In-place status edits, Bearer git auth (token not in clone URL)
- `POST /webhooks/github` plus poll fallback
- 10 starts / 30 tweaks per user per hour
- `GET /health` · `GET /ready` · SIGTERM drain

```bash
docker compose up --build
# or
NODE_ENV=production npm start
```

`npm test` and `npx tsc --noEmit` run in CI.

## Commands

| | |
|---|---|
| `/minute` | Picker: change the playground, or start a new GitHub repo |
| `/minute kind: Start a new project` | Create a new repo (form if you skip the request) |
| `/minute make the header green` | Tweak the wired playground |
| `@Minute start a new project …` | Scratch from a mention |
| Reply in the thread | Tweak (same PR) |
| **Looks good** | Ping tech; photo is on the PR |
| **Cancel** | Stop |
| `/minute-admin allow @user` | Grant access |
| `/minute-admin revoke @user` | Revoke |
| `/minute-admin` / `who` | Show rails |

Tech never has to merge from chat. They review the PR as usual. `CHANGES_REQUESTED` or closing the PR posts an exit in the thread and Minute does not keep iterating.

## Layout

```
src/protocol.ts      the loop
src/queue.ts         durable jobs
src/db.ts            SQLite
src/agent.ts         smallest patch inside allow.paths
src/preview.ts       npm install + Playwright
src/webhooks.ts      GitHub
src/conversation.ts  shared start + chips
minute.config.yaml   playgrounds
```
