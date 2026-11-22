"""Backend tests for Minute: /api/health, /api/llm/complete, /api/minute/* bridge."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- health ---
class TestHealth:
    def test_health(self, client):
        r = client.get(f"{BASE_URL}/api/health", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["service"] == "minute-proxy"
        assert d.get("backend") == "ollama" or d.get("model")
        assert d["llm_configured"] is True


# --- LLM (local Ollama) ---
class TestLLM:
    def test_complete_returns_text(self, client):
        r = client.post(
            f"{BASE_URL}/api/llm/complete",
            json={"prompt": "Reply with exactly: PONG", "max_tokens": 20},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("text"), str)
        assert d["text"].strip() != ""
        assert "PONG" in d["text"].upper()

    def test_complete_with_system(self, client):
        r = client.post(
            f"{BASE_URL}/api/llm/complete",
            json={"prompt": "Say OK", "max_tokens": 20, "system": "Answer with a single word."},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        assert r.json()["text"].strip() != ""

    def test_complete_validation_error(self, client):
        r = client.post(f"{BASE_URL}/api/llm/complete", json={}, timeout=30)
        assert r.status_code == 422, r.text


# --- minute bridge ---
class TestMinuteBridge:
    def test_overview(self, client):
        r = client.get(f"{BASE_URL}/api/minute/overview", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("up") is True, d
        assert d.get("githubConfigured") is True, d
        assert d.get("surfaces", {}).get("discord") is True, d
        pgs = d.get("playgrounds")
        assert isinstance(pgs, list) and len(pgs) > 0
        pg = next((p for p in pgs if p["id"] == "llmwatermarking"), None)
        assert pg is not None, pgs
        assert pg["repo"] == "Aditya-Sarna/llmwatermarking"
        assert "frontend/src/" in pg["allowPaths"]
        assert "_id" not in d

    def test_runs(self, client):
        r = client.get(f"{BASE_URL}/api/minute/runs", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("runs"), list)
        assert "error" not in d, d


# --- workflow guardrail pre-flight simulator ---
class TestPreflight:
    def test_preflight_allowed_visual_request(self, client):
        r = client.post(
            f"{BASE_URL}/api/minute/preflight",
            json={"request": "@minute make the header forest green and tweak font spacing"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["status"] == "accepted"
        assert d["category"] == "visual_tweak"
        assert len(d["matched_refusals"]) == 0

    def test_preflight_refused_restricted_scope(self, client):
        r = client.post(
            f"{BASE_URL}/api/minute/preflight",
            json={"request": "@minute configure OAuth authentication and stripe payments migration"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert d["status"] == "refused"
        assert d["category"] == "hard_refusal"
        assert "auth" in d["matched_refusals"] or "payments" in d["matched_refusals"] or "migrations" in d["matched_refusals"]

    def test_preflight_validation_error(self, client):
        r = client.post(f"{BASE_URL}/api/minute/preflight", json={"request": ""}, timeout=30)
        assert r.status_code == 400
