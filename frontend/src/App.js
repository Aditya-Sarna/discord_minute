import { useEffect, useState, useCallback } from "react";
import "@/App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUS_META = {
  classifying: { label: "Classifying", cls: "st-work" },
  working: { label: "Working", cls: "st-work" },
  proof: { label: "Preview ready", cls: "st-proof" },
  handed_off: { label: "With tech", cls: "st-hand" },
  exited: { label: "Done", cls: "st-done" },
  refused: { label: "Refused", cls: "st-ref" },
};

const LOOP = [
  { k: "/minute", d: "Non-tech ask in chat" },
  { k: "working", d: "Fetch repo · smallest change" },
  { k: "photo", d: "Screenshot in the thread" },
  { k: "tweak", d: "Iterate — same PR" },
  { k: "looks good", d: "Ping tech with the PR" },
  { k: "approve", d: "Tech merges · Minute exits" },
];

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

  return (
    <div className="wrap" data-testid="minute-dashboard">
      <div className="grain" />

      <header className="top">
        <div className="brand">
          <div className="logo">◷</div>
          <div>
            <div className="brand-name" data-testid="brand-name">minute</div>
            <div className="brand-sub">the thin handoff between non-tech &amp; engineering</div>
          </div>
        </div>
        <div className="pills" data-testid="status-pills">
          <Pill ok={up} label="Service" value={up ? "live" : overview === null && !err ? "…" : "down"} />
          <Pill ok={health?.llm_configured} label="LLM" value={health?.model || "…"} />
          <Pill ok={overview?.githubConfigured} label="GitHub" />
          <Pill ok={discordOn} label="Discord" />
          <Pill ok={overview?.surfaces?.slack} label="Slack" />
        </div>
      </header>

      {err && (
        <div className="banner banner-err" data-testid="error-banner">
          {err} — the control API may be starting. Retrying…
        </div>
      )}
      {up && discordOn === false && (
        <div className="banner banner-warn" data-testid="discord-warn">
          Discord bot isn't connected yet. Enable <b>Message Content Intent</b> in the Developer Portal and invite the
          bot, then the loop goes live.
        </div>
      )}

      <section className="hero">
        <h1>
          Someone who doesn't know git types <span className="hl">/minute</span>.<br />
          A photo of the change lands in the same thread.
        </h1>
        <p className="lede">
          Minute turns a plain-language request into the smallest possible pull request, screenshots the running app,
          and posts it back in chat. The stakeholder iterates by replying. Tech only ever reviews the PR.
        </p>
      </section>

      <section className="loop" data-testid="loop">
        {LOOP.map((s, i) => (
          <div className="loop-step" key={s.k}>
            <div className="loop-k">{s.k}</div>
            <div className="loop-d">{s.d}</div>
            {i < LOOP.length - 1 && <div className="loop-arrow">→</div>}
          </div>
        ))}
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
            <div className="cmd"><code>/minute</code> start a change in this channel</div>
            <div className="cmd"><b>reply</b> in the thread to tweak</div>
            <div className="cmd"><b>Looks good</b> → tech is pinged with the PR</div>
            <div className="cmd"><code>/minute-admin allow @user</code> grant access</div>
          </div>
        </section>
      </div>

      <section className="card runs" data-testid="runs-card">
        <div className="card-h">
          <span>Runs</span>
          <span className="muted">{runs.length} recent · in-flight {overview?.inflight ?? 0}</span>
        </div>
        {runs.length === 0 ? (
          <div className="empty" data-testid="runs-empty">
            No runs yet. Type <code>/minute change the main page color to green</code> in your Discord playground channel.
          </div>
        ) : (
          <table data-testid="runs-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Requester</th>
                <th>Request</th>
                <th>PR</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const meta = STATUS_META[r.status] || { label: r.status, cls: "" };
                return (
                  <tr key={r.id} data-testid={`run-${r.id}`}>
                    <td>
                      <span className={`badge ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td>{r.requesterName}</td>
                    <td className="req">{(r.request || "").split("\n")[0].slice(0, 70)}</td>
                    <td>
                      {r.prUrl ? (
                        <a href={r.prUrl} target="_blank" rel="noreferrer" data-testid={`run-pr-${r.id}`}>
                          #{r.prNumber}
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">{new Date(r.updatedAt).toLocaleTimeString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer className="foot">
        Minute · Claude Sonnet 4.6 via Emergent · runs on GitHub PRs · git stays on the tech side
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
