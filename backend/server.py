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


class PreflightReq(BaseModel):
    request: str
    playground_id: str | None = None


DEFAULT_REFUSALS = [
    "auth",
    "authentication",
    "payments",
    "billing",
    "migrations",
    "infrastructure",
    "secrets",
    "production deploy",
    "rewrite",
    "architecture",
]


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


@app.post("/api/minute/preflight")
async def preflight(req: PreflightReq):
    """Workflow guardrail simulator: tests a stakeholder request against playground policies."""
    text = (req.request or "").strip()
    if not text:
        raise HTTPException(400, "Request text cannot be empty.")

    playgrounds = []
    try:
        data = await _bridge("/internal/overview")
        playgrounds = data.get("playgrounds", [])
    except Exception:  # noqa: BLE001
        pass

    target_pg = None
    if req.playground_id:
        target_pg = next((p for p in playgrounds if p.get("id") == req.playground_id), None)
    if not target_pg and playgrounds:
        target_pg = playgrounds[0]

    refusals = target_pg.get("refuse", DEFAULT_REFUSALS) if target_pg else DEFAULT_REFUSALS
    routes = target_pg.get("allowRoutes", ["/"]) if target_pg else ["/"]
    paths = target_pg.get("allowPaths", ["frontend/src/", "src/", "public/"]) if target_pg else ["frontend/src/"]

    lowered = text.lower()
    matched_refusals = [r for r in refusals if r in lowered]

    if matched_refusals:
        return {
            "ok": False,
            "status": "refused",
            "reason": f"Refused by Minute policy. Request touches restricted scope: {', '.join(matched_refusals)}. Ping tech directly.",
            "matched_refusals": matched_refusals,
            "route": routes[0] if routes else "/",
            "allowed_paths": paths,
            "category": "hard_refusal",
        }

    visual_clues = [
        "color", "header", "button", "font", "text", "copy",
        "spacing", "logo", "icon", "dark", "hide", "show", "mobile", "desktop", "tab", "image"
    ]
    matched_clues = [c for c in visual_clues if c in lowered]
    is_visual = len(matched_clues) > 0

    return {
        "ok": True,
        "status": "accepted",
        "reason": "Request passes all safety allowlists and policy guardrails. Safe for automated visual patch.",
        "matched_refusals": [],
        "route": routes[0] if routes else "/",
        "allowed_paths": paths,
        "category": "visual_tweak" if is_visual else "general_edit",
        "detected_intents": matched_clues,
    }
