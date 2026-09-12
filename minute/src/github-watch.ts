import { playgroundForRun } from "./config.js";
import { handedOffRuns, getRun } from "./store.js";
import { enqueueGithub } from "./jobs.js";
import { getPr, listReviews } from "./github.js";
import { log } from "./logger.js";

const seen = new Set<string>();
let watchTimer: ReturnType<typeof setInterval> | undefined;

export function startGithubWatch() {
  const tick = async () => {
    for (const run of handedOffRuns()) {
      const pg = playgroundForRun(run);
      if (!pg || !run.prNumber) continue;
      try {
        const pr = await getPr(pg, run.prNumber);
        const key = (s: string) => `${run.id}:${s}`;
        const live = getRun(run.id) ?? run;
        if (live.status !== "handed_off") continue;

        if (pr.data.merged) {
          if (seen.has(key("merged"))) continue;
          seen.add(key("merged"));
          enqueueGithub(live.id, "merged");
          continue;
        }
        if (pr.data.state === "closed") {
          if (seen.has(key("closed"))) continue;
          seen.add(key("closed"));
          enqueueGithub(live.id, "closed");
          continue;
        }
        const reviews = await listReviews(pg, run.prNumber);
        if (reviews.some((r) => r.state === "CHANGES_REQUESTED")) {
          if (seen.has(key("changes"))) continue;
          seen.add(key("changes"));
          enqueueGithub(live.id, "changes_requested");
        }
        if (seen.size > 2_000) seen.clear();
      } catch (err) {
        log.warn({ err, runId: run.id }, "github watch");
      }
    }
  };

  watchTimer = setInterval(() => void tick(), 30_000);
  void tick();
}

export function stopGithubWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = undefined;
}
