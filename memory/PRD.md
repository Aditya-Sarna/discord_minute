# Minute — PRD & Build Log

## Original problem statement
Clone `github.com/Aditya-Sarna/minute` and make it production-grade, integrating LLM keys.
Minute is a Discord plugin: a non-technical person types a plain request in chat
(e.g. `/minute change the main page color to green`); the backend fetches the repo, makes
the smallest PR, screenshots the running change, replies in the same thread; the user iterates
by replying; on "Looks good" tech is pinged to review the PR; tech approves/merges — the user
never leaves chat.

## User choices
- Chat surface first: **Discord**
- LLM: **Claude Sonnet 4.6**
- Preview: **live screenshot of the running app**
- Approval: **merge on tech approval** (via GitHub PR review/merge)

## Architecture (as deployed here)
- **/app/minute** — the original Node/TypeScript product (Fastify + discord.js +
  Octokit + simple-git + Playwright + node:sqlite). Runs under supervisor program `minute` on
  port 8787 using **Node 22** at `/opt/node22/bin/node` (pod default is Node 20; node:sqlite needs 22).
- **/app/backend/server.py** — FastAPI on 8001: (1) LLM proxy `/api/llm/complete` using the
  **Emergent universal key + Claude Sonnet 4.6** via `emergentintegrations`; (2) dashboard bridge
  `/api/minute/overview` + `/api/minute/runs` (proxy to Node `/internal/*`); (3) `/api/health`.
- **/app/frontend** — React control dashboard (status pills, the loop, playgrounds, people, runs).
- LLM wiring: Node `src/llm.ts` calls the FastAPI proxy when `MINUTE_LLM_PROXY_URL` is set — no
  Anthropic key required from the user.
- Playground config: `/app/minute/minute.config.yaml` (repo `Aditya-Sarna/llmwatermarking`,
  Discord channel `1541869097418096673`, admin/requester/tech = Discord user `1441931062652571672`).

## Production changes made
- Node LLM client routes through the Emergent key proxy (llm.ts) + retry.
- git.ts: GitHub HTTPS auth switched from Bearer → **Basic** (PAT was 401-prompting).
- index.ts: service boots resilient (LLM required; GitHub/chat warn-not-crash); Discord login has
  **automatic intent fallback** (connects without MessageContent if the privileged intent is off);
  added `/internal/overview` + `/internal/runs`; unhandledRejection/uncaughtException handlers.
- store.ts: `recentRuns`, `runCounts` for the dashboard.
- Frontend dashboard built from scratch.

## Verified (this session)
- LLM proxy end-to-end (Claude Sonnet 4.6 → "PONG"). ✅
- Backend E2E pipeline against real repo: classify → clone → LLM edit (`frontend/src/index.css` →
  forest green) → commit. ✅  (push/PR blocked only by the read-only token — see below.)
- Node typecheck clean; 6/6 unit tests pass. ✅
- Discord bot **connected** (`minute#6838`) via intent fallback. ✅
- Backend API tests 6/6 (testing agent); dashboard renders + live-polls. ✅

## Blocked on user action (not code)
- **GitHub token is read-only** → push/PR/merge return 403. Needs classic `repo` scope (or
  fine-grained Contents + Pull requests read/write). Swap the value in `/app/minute/.env`.
- **Message Content Intent** OFF → reply-to-tweak disabled until enabled (core loop works now).
- Invite the bot to the server/channel via the OAuth URL if not already present.

## Backlog / next
- P1: On admin approval in-chat, auto-merge PR (currently tech reviews PR on GitHub; merge/close/
  changes-requested are detected via poll + webhook and reflected in the thread).
- P1: Harden live-preview boot for the target CRACO app (install + `npm start` on :3055) — may be
  heavy; falls back to "no live photo" + PR on failure.
- P2: GitHub webhook secret for instant PR events (poll fallback active).
