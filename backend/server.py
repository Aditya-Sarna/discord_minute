"""Minute — local Ollama LLM + dashboard bridge to the Node bot."""
import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "minute", ".env"))

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("MINUTE_LLM_MODEL", os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b"))
MINUTE_INTERNAL_URL = os.environ.get("MINUTE_INTERNAL_URL", "http://localhost:8787")

app = FastAPI(title="Minute Ollama proxy & bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CompleteReq(BaseModel):
    prompt: str
    max_tokens: int | None = 8000
    system: str | None = None


async def ollama_up() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2) as c:
            r = await c.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


@app.get("/api/health")
async def health():
    up = await ollama_up()
    return {
        "ok": up,
        "service": "minute-proxy",
        "model": MODEL,
        "backend": "ollama",
        "llm_configured": up,
    }


@app.post("/api/llm/complete")
async def complete(req: CompleteReq):
    messages = []
    if req.system:
        messages.append({"role": "system", "content": req.system})
    messages.append({"role": "user", "content": req.prompt})
    try:
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(
                f"{OLLAMA_BASE}/api/chat",
                json={
                    "model": MODEL,
                    "messages": messages,
                    "stream": False,
                    "options": {"num_predict": req.max_tokens or 8000, "temperature": 0.2},
                },
            )
    except httpx.ConnectError as e:
        raise HTTPException(
            503,
            f"Ollama is not running at {OLLAMA_BASE}. Start it with `ollama serve` and `ollama pull {MODEL}`.",
        ) from e
    if r.status_code >= 400:
        raise HTTPException(502, f"Ollama {r.status_code}: {r.text[:400]}")
    data = r.json()
    text = (data.get("message") or {}).get("content") or data.get("response") or ""
    return {"text": text}


async def _bridge(path: str):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{MINUTE_INTERNAL_URL}{path}")
        return r.json()


@app.get("/api/minute/overview")
async def overview():
    try:
        data = await _bridge("/internal/overview")
        data["up"] = True
        return data
    except Exception as e:  # noqa: BLE001
        return {"up": False, "error": str(e)}


@app.get("/api/minute/runs")
async def runs():
    try:
        return await _bridge("/internal/runs")
    except Exception as e:  # noqa: BLE001
        return {"runs": [], "error": str(e)}
