import { useEffect, useState, useCallback } from "react";
import "@/App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUS_META = {
  classifying: { label: "Asking", cls: "st-work" },
  working: { label: "Working", cls: "st-work" },
  proof: { label: "Photo ready", cls: "st-proof" },
  handed_off: { label: "With tech", cls: "st-hand" },
  exited: { label: "Done", cls: "st-done" },
  refused: { label: "Stopped", cls: "st-ref" },
};

function Pill({ ok, label, value }) {
  return (
    <div className={`pill ${ok ? "pill-on" : "pill-off"}`} data-testid={`pill-${label.toLowerCase()}`}>
      <span className="dot" />
      <span className="pill-label">{label}</span>
      {value ? <span className="pill-val">{value}</span> : null}
    </div>
  );
}

function App() {
  const [overview, setOverview] = useState(null);
  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [o, r, h] = await Promise.all([
        axios.get(`${API}/minute/overview`),
        axios.get(`${API}/minute/runs`),
        axios.get(`${API}/health`),
      ]);
      setOverview(o.data);
      setRuns(r.data.runs || []);
      setHealth(h.data);
      setErr(null);
    } catch (e) {
      setErr(e.message || "Unable to reach Minute");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (tick > 0) load();
  }, [tick, load]);

  const up = overview?.up;
  const discordOn = overview?.surfaces?.discord;
  const messageContent = overview?.intents?.messageContent;
  const githubWrite = overview?.githubWrite;

  return (
    <div className="wrap" data-testid="minute-dashboard">
      <div className="grain" />

      <header className="top">
        <div className="brand">
          <div className="logo">◷</div>
          <div>
            <div className="brand-name" data-testid="brand-name">minute</div>
            <div className="brand-sub">talk in Discord · photo of the change · PR for tech</div>
          </div>
        </div>
        <div className="pills" data-testid="status-pills">
          <Pill ok={up} label="Service" value={up ? "live" : overview === null && !err ? "…" : "down"} />
          <Pill ok={health?.llm_configured ?? overview?.llmConfigured} label="LLM" value={health?.model || overview?.llmModel || "…"} />
          <Pill ok={overview?.githubConfigured && githubWrite !== false} label="GitHub" value={githubWrite === false ? "read-only" : undefined} />
          <Pill ok={discordOn} label="Discord" value={overview?.discord?.userTag} />
        </div>
      </header>

      {err && (
        <div className="banner banner-err" data-testid="error-banner">
          {err} — the control API may be starting. Retrying…
        </div>
      )}
      {up && discordOn === false && (
        <div className="banner banner-warn" data-testid="discord-warn">
          Discord isn’t connected. Invite the bot, then talk in the playground channel.
        </div>
      )}
      {up && discordOn && messageContent === false && (
        <div className="banner banner-warn" data-testid="intent-warn">
          Message Content Intent is off — replies in the thread won’t reach Minute. Turn it on in the Developer Portal.
        </div>
      )}
      {up && githubWrite === false && (
        <div className="banner banner-warn" data-testid="github-warn">
          GitHub token can’t write. Minute can talk, but it can’t open a PR until the token has repo write.
        </div>
      )}

      <section className="hero">
        <h1>
          Say <span className="hl">@minute make the header green</span> — or drop a mock.<br />
          A Playwright photo comes back in the same thread.
        </h1>
        <p className="lede">
          Talk, or attach an image / PDF / logo. Minute asks if it’s confused, edits the playground, and answers with a
          screenshot of the running change. Say <b>looks good</b> when the photo is right. Tech reviews the PR — which
          describes that change, not the chat log.
        </p>
      </section>

      <section className="loop" data-testid="loop">
        <div className="loop-step">
          <div className="loop-k">talk or drop</div>
          <div className="loop-d">@minute, /minute, or a file</div>
          <div className="loop-arrow">→</div>
        </div>
        <div className="loop-step">
          <div className="loop-k">photo</div>
          <div className="loop-d">Playwright shot of this branch</div>
          <div className="loop-arrow">→</div>
        </div>
        <div className="loop-step">
          <div className="loop-k">looks good</div>
          <div className="loop-d">say it or tap it</div>
          <div className="loop-arrow">→</div>
        </div>
        <div className="loop-step">
          <div className="loop-k">PR</div>
          <div className="loop-d">diff + photo, for tech</div>
        </div>
      </section>

      <div className="grid">
        <section className="card" data-testid="playgrounds-card">
          <div className="card-h">
            <span>Playgrounds</span>
            <span className="muted">channel → repo</span>
          </div>
          {(overview?.playgrounds || []).map((p) => (
            <div className="pg" key={p.id} data-testid={`playground-${p.id}`}>
              <div className="pg-top">
                <div className="pg-id">{p.id}</div>
                <a
                  className="pg-repo"
                  href={`https://github.com/${p.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`playground-repo-${p.id}`}
                >
                  {p.repo}
                </a>
              </div>
              <div className="pg-meta">
                <span className="tag">branch: {p.defaultBranch}</span>
                <span className={`tag ${p.livePreview ? "tag-on" : ""}`}>
                  {p.livePreview ? "live screenshot" : "no live photo"}
                </span>
                {p.discordChannelIds?.map((c) => (
                  <span className="tag tag-mono" key={c}>#{c.slice(-6)}</span>
                ))}
              </div>
              <div className="pg-paths">
                {p.allowPaths.map((a) => (
                  <code key={a}>{a}</code>
                ))}
              </div>
            </div>
          ))}
          {!overview?.playgrounds?.length && <div className="empty">No playgrounds configured.</div>}
        </section>

        <section className="card" data-testid="people-card">
          <div className="card-h">
            <span>People &amp; rails</span>
            <span className="muted">access</span>
          </div>
          <PeopleRow label="Admins" ids={overview?.admins?.discordUserIds} />
          <PeopleRow label="Requesters" ids={overview?.requesters?.discordUserIds} />
          <PeopleRow label="Tech (approves)" ids={overview?.tech?.discordUserIds} />
          <div className="cmds">
            <div className="cmd"><code>@minute</code> or <code>/minute</code> — talk, or drop a file</div>
            <div className="cmd"><b>reply</b> in the thread to tweak</div>
            <div className="cmd">say <b>looks good</b> or tap it → tech is pinged</div>
            <div className="cmd"><code>/minute-admin allow @user</code> grant access</div>
          </div>
        </section>
      </div>

      <section className="card runs" data-testid="runs-card">
        <div className="card-h">
          <span>Live</span>
          <span className="muted">{runs.length} recent · in-flight {overview?.inflight ?? 0}</span>
        </div>
        {runs.length === 0 ? (
          <div className="empty" data-testid="runs-empty">
            Nothing yet. In Discord: <code>@minute make the header green</code> — or drop a mock.
          </div>
        ) : (
          <div className="radio" data-testid="runs-table">
            {runs.map((r) => {
              const meta = STATUS_META[r.status] || { label: r.status, cls: "" };
              const line = r.lastSummary || (r.request || "").split("\n")[0];
              return (
                <div className="radio-row" key={r.id} data-testid={`run-${r.id}`}>
                  <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  <div className="radio-body">
                    <div className="radio-who">{r.requesterName}</div>
                    <div className="radio-line">{line?.slice(0, 90)}</div>
                  </div>
                  {r.prUrl ? (
                    <a href={r.prUrl} target="_blank" rel="noreferrer" data-testid={`run-pr-${r.id}`}>
                      #{r.prNumber}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  <span className="muted radio-time">{new Date(r.updatedAt).toLocaleTimeString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="foot">
        Minute · Discord conversation · Playwright proof · PR describes the diff
      </footer>
    </div>
  );
}

function PeopleRow({ label, ids }) {
  return (
    <div className="prow">
      <span className="prow-l">{label}</span>
      <span className="prow-v">
        {ids?.length ? ids.map((id) => <code key={id}>{id.slice(-6)}</code>) : <span className="muted">none</span>}
      </span>
    </div>
  );
}

export default App;
