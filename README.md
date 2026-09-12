# Minute

Talk in Discord. Minute answers with a **Playwright photo** of the running change. Tech reviews a PR that describes that change — not the chat log.

```
@minute make the header green
        (or drop a mock / PDF / logo)
        ↓
same thread: “On it” → photo of this branch
        ↓
reply “a bit darker”  ·  or drop another file
        ↓
looks good  →  tech is pinged
```

## This repo

| Path | What |
|---|---|
| `minute/` | Discord bot (Node 22) — the product |
| `backend/` | FastAPI dashboard bridge (optional; talks to the same local Ollama) |
| `frontend/` | Operator radio (live runs, health) |

## Run

```bash
# local open-source LLM (Ollama)
# install: https://ollama.com/download  — then:
ollama serve
ollama pull qwen2.5-coder:7b

# bot
cd minute
cp .env.example .env
# wire playgrounds in minute.config.yaml
npm install
npx playwright install chromium
npm start

# dashboard bridge (optional — FastAPI talks to the same Ollama)
cd backend
pip install -r requirements.txt
uvicorn server:app --port 8001
```

Discord: Message Content Intent on. Invite the bot. `/minute` appears in the guild within seconds (registered on ready). Or mention `@minute`.

Drop an image to match, a PDF/doc as spec, or a logo to place. If you drop a file with no words, Minute asks: Match this / Read as spec / Put in the repo.

The PR title and body are rewritten from `git diff` after every tweak. The after-shot is Playwright against the branch Minute just edited — never a screenshot of staging pretending to be the change.
