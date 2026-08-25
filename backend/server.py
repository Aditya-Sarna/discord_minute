"""Minute — LLM proxy (Emergent universal key) + dashboard bridge.

The Node "minute" agent (port 8787) is stateless w.r.t. the model: it POSTs a
prompt here and gets completed text back. This keeps the Emergent universal key
server-side and lets the whole app run on Claude Sonnet 4.6 with no user key.
"""
import os
import uuid

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
MINUTE_INTERNAL_URL = os.environ.get("MINUTE_INTERNAL_URL", "http://localhost:8787")
MODEL = os.environ.get("MINUTE_LLM_MODEL_NAME", "claude-sonnet-4-6")

app = FastAPI(title="Minute LLM Proxy & Bridge")
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


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "minute-proxy",
        "model": MODEL,
        "llm_configured": bool(EMERGENT_LLM_KEY),
    }


@app.post("/api/llm/complete")
async def complete(req: CompleteReq):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "EMERGENT_LLM_KEY not configured")
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"minute-{uuid.uuid4().hex}",
        system_message=req.system or "You are Minute, a precise code-editing assistant. You make the smallest correct change and always reply exactly in the format requested.",
    ).with_model("anthropic", MODEL).with_params(max_tokens=req.max_tokens or 8000)
    try:
        text = await chat.send_message(UserMessage(text=req.prompt))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"LLM error: {e}")
    return {"text": text if isinstance(text, str) else str(text)}


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
