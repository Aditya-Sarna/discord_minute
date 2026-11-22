# Presenter 3: Ashutosh — Configuration & Operator Dashboard

**Theme:** How Minute is configured, secured, and observed  
**Contributor:** Ashutosh Sharma (Ashutosh Mishra)  
**Project:** Minute (Discord-Native Constrained Visual Change Loop)

---

## 1. Executive Summary & Ownership

In the Minute architecture, stakeholders interact exclusively through Discord while engineers review pull requests on GitHub. As **Presenter 3**, my primary ownership spans the operational foundation that defines **how Minute is configured, governed, and observed**:

1. **System & Playground Configuration (`minute.config.yaml`, `minute/src/config.ts`)**:
   - Schema validation with Zod.
   - Declarative playground mappings connecting Discord channel IDs to target GitHub repositories and preview environments.
   - Path allowlists and strict safety refusals (blocking requests touching auth, payments, migrations, infrastructure, secrets, etc.).
   - Access control roles (`admins`, `requesters`, `tech`).

2. **Workflow Pre-Flight Simulator & Guardrail Sandbox (Unique Innovation)**:
   - Built an interactive **Pre-Flight Policy Simulator** in `backend/server.py` and `frontend/src/App.js`.
   - Allows operators and engineers to dry-run stakeholder requests against active playground guardrails before hitting Discord or modifying Git.
   - Evaluates keyword refusals, predicts target routes, classifies intent (e.g. `visual_tweak` vs `hard_refusal`), and displays the exact spoken response Minute would return in Discord.

3. **LLM Backend & Inference Routing (`minute/src/llm.ts`)**:
   - Zero-cost local-first LLM inference using Ollama (`qwen2.5-coder:7b`).
   - Pluggable multi-backend architecture supporting `ollama`, `proxy`, `anthropic`, and `openai`.
   - Resilience: Connection detection, exponential backoff with retry, and structured JSON parsing.

4. **FastAPI Operator Bridge (`backend/server.py`)**:
   - Asynchronous Python proxy layer connecting the React dashboard with Ollama and Minute's internal daemon.
   - Endpoints: `/api/health`, `/api/llm/complete`, `/api/minute/overview`, `/api/minute/runs`, and `/api/minute/preflight`.

5. **React Operator Dashboard (`frontend/src/App.js`, `App.css`)**:
   - Live operator UI providing visibility into service status, LLM availability, Discord intents, and GitHub write permissions.
   - Live playground inspector rendering active allowed paths and safety refusal tags.
   - Integrated workflow simulator with quick-action presets for visual tweaks, payment blocks, auth refusals, and viewport switches.
   - Run stream displaying execution stages (`asking`, `working`, `photo ready`, `with tech`, `done`, `refused`).

6. **Health, Readiness & Internal Telemetry APIs (`minute/src/index.ts`, `overview.ts`)**:
   - Container `/health` probe for Docker Compose.
   - Comprehensive `/ready` probe checking Discord connection, GitHub token write access, LLM responsiveness, and Playwright Chromium availability.
   - Authenticated `/internal/overview` and `/internal/runs` data feeds exposing guardrail metadata.

---

## 2. Deep Dive: Key Files & Contributions

### A. `minute/minute.config.yaml` & `minute/src/config.ts`
*Declarative Configuration & Guardrails*

- **Declarative YAML Schema**:
  ```yaml
  minute:
    name: Office
    admins:
      discordUserIds: ["1441931062652571672"]
    requesters:
      discordUserIds: ["1441931062652571672"]
    tech:
      discordUserIds: ["1441931062652571672"]
    playgrounds:
      - id: llmwatermarking
        discordChannelIds: ["1541869097418096673"]
        github:
          owner: Aditya-Sarna
          repo: llmwatermarking
          defaultBranch: main
        preview:
          command: npm start
          cwd: frontend
          url: http://localhost:3055
        allow:
          paths: [frontend/src/, src/, app/, public/, content/, components/]
          routes: [/]
        refuse: [auth, authentication, payments, billing, migrations, infrastructure, secrets]
  ```
- **Zod Runtime Validation (`config.ts`)**:
  - Enforces strict type-safety on boot.
  - Resolves channel IDs to specific playgrounds (`playgroundForChannel`).
  - Implements path confinement so edits can never escape allowed directories.
  - Dynamically overlays scratch environments when ad-hoc runs are instantiated.

### B. `minute/src/llm.ts`
*LLM Backend Flexibility & Resilience*

- Implements an environment-switchable backend (`MINUTE_LLM_BACKEND`):
  - **Ollama (`viaOllama`)**: Direct HTTP calls to local Ollama daemon on `127.0.0.1:11434`.
  - **Proxy**: Forwarding requests through FastAPI proxy.
  - **Cloud Providers**: Native SDK integrations for Anthropic (`claude-3-5-sonnet`) and OpenAI (`gpt-4o`).
- **Resilience**:
  - Exponential backoff (`withRetry`) on transient 429, 503, or rate-limit responses.
  - Clear diagnosis when Ollama is offline (`ollamaUp()`).
  - Robust JSON extraction (`extractJson`) stripping markdown fences from LLM answers.

### C. `backend/server.py`
*FastAPI Bridge & Pre-Flight Inference Proxy*

- Connects the operator frontend to both the local Ollama daemon and the Node bot.
- **Endpoints**:
  - `GET /api/health`: Health status of Ollama, active model, and backend readiness.
  - `POST /api/llm/complete`: Structured completions with temperature control and system prompts.
  - `GET /api/minute/overview`: Proxies internal daemon configuration and Discord/GitHub connectivity.
  - `GET /api/minute/runs`: Fetches real-time SQLite run records for operator monitoring.
  - `POST /api/minute/preflight`: **Unique Workflow Feature** — evaluates an incoming prompt against safety allowlists, active playground routes, and restricted scope keywords (`auth`, `payments`, `billing`, `migrations`, etc.), returning an immediate pre-flight verdict.

### D. `frontend/src/App.js` & `App.css`
*Operator Radio & Workflow Pre-Flight Simulator*

- React 19 single-page dashboard polling the FastAPI bridge every 5 seconds.
- **Live Status Pills**:
  - **Service**: Live vs. Down.
  - **LLM**: Active model and connection status.
  - **GitHub**: Read/Write vs. Read-Only status.
  - **Discord**: Connected bot user tag.
- **Playground Guardrail Inspector**: Displays not only allowed file paths, but also actively enforced refusal lists and default routes.
- **Interactive Workflow Pre-Flight Sandbox**:
  - Operators can input any prompt or tap one-click presets (e.g., *🎨 Visual: Green Header*, *🚫 Refusal: Stripe Billing*, *🔒 Refusal: OAuth Auth*, *📱 Viewport: Mobile*).
  - Simulates the exact gatekeeper check without touching Discord or creating branch churn.
  - Renders live verdict badges (`ACCEPTED` vs `REFUSED`), reason explanations, and highlighted policy guardrail triggers.
- **Warning Banners**: Proactively warns operators if Discord message content intent is disabled, credentials are missing, or the service is restarting.
- **Run Monitor**: Displays all runs with status badges (`st-work`, `st-proof`, `st-hand`, `st-done`, `st-ref`).

### E. `minute/src/index.ts`
*Health, Readiness, & Internal Endpoints*

- **`/health`**: Returns `{ ok: true }` instantly for Docker health checks.
- **`/ready`**: Multi-factor readiness check verifying:
  - Config loaded.
  - GitHub token has repository write permissions (`githubWriteOk()`).
  - Discord gateway client is connected and ready.
  - Message content intent is verified.
  - LLM backend is responding.
  - Playwright Chromium browser is installed and runnable.
- **`/internal/overview` & `/internal/runs`**: Protected endpoints serving operational state to the dashboard.

---

## 3. How to Run & Verify

1. **Test FastAPI Bridge & Tests**:
   ```bash
   cd backend
   pip install -r requirements.txt
   pytest tests/backend_test.py
   uvicorn server:app --port 8001
   ```

2. **Start the Operator Dashboard**:
   ```bash
   cd frontend
   npm install
   REACT_APP_BACKEND_URL=http://localhost:8001 npm start
   ```

3. **Verify Minute Node Daemon Readiness**:
   ```bash
   cd minute
   npm run check:ready
   curl http://localhost:8787/ready
   ```
