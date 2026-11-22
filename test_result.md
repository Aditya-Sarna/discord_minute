# Test results

Notes from the testing and delivery work on Minute.

## Tests in minute/

From the `minute` folder, `npm test` runs both files in `test/`.

`core.test.ts` stays offline. No Discord login and no GitHub token. It checks that an edit stays inside the allowed paths, a text change is applied once, a run is saved in SQLite and can be claimed once, rate limits hold, and replies like "looks good" and "cancel" are read the right way.

`photo.e2e.test.ts` starts the small sample app with Playwright, saves a desktop png and a phone png, then closes the preview. The browser install is `npx playwright install chromium`.

## API and dashboard

The run saved in `test_reports/iteration_1.json` is 6/6 for `backend/tests/backend_test.py`.

- `/api/health` came back up
- the model replied
- a system prompt was accepted
- an empty body was rejected
- `/api/minute/overview` returned the playground
- `/api/minute/runs` returned the runs list

The React page showed status, the loop, playgrounds, people, and runs. It kept polling, and the console had no errors.

## CI

`.github/workflows/ci.yml` inside `minute/` runs on push to main and on pull requests. The job uses Node 22, `npm ci`, Playwright Chromium, `tsc --noEmit`, and `npm test`.

## How we start it

Tests:

```bash
cd minute
npm install
npx playwright install chromium
npm test
```

API and dashboard:

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --port 8001
```

`pytest tests/backend_test.py` uses `REACT_APP_BACKEND_URL` for that API. The React app is started from `frontend` with `npm start` and the same URL.

Docker, from `minute`:

```bash
docker compose up --build
```

Port 8787. Compose checks `/health`. The `minute-data` volume holds `minute.sqlite`, so runs, jobs, and access are still there after a restart. On startup a job left in progress goes back on the queue. On shutdown the preview processes are closed.

## Result

The API tests passed 6/6, the dashboard loaded and kept updating, and the bot is set up to come back from Docker with its SQLite data intact.
