import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WebClient } from "@slack/web-api";
import { parseButton } from "../src/buttons.js";
import { slackAdapter } from "../src/surfaces/slack.js";
import type { Run } from "../src/types.js";

test("slackAdapter uploads the photo and posts signed buttons", async () => {
  const shotDir = mkdtempSync(join(tmpdir(), "minute-slack-proof-"));
  const afterPath = join(shotDir, "after.png");
  writeFileSync(afterPath, "png");
  const uploads: { filename?: string; thread_ts?: string }[] = [];
  const messages: { text?: string; blocks?: { elements?: { value?: string; action_id?: string }[] }[] }[] = [];
  const client = {
    chat: {
      postMessage: async (args: { text?: string; blocks?: { elements?: { value?: string }[] }[] }) => {
        messages.push(args);
        return { ts: "1700000000.000100" };
      },
      update: async () => ({}),
    },
    files: {
      uploadV2: async (args: { filename?: string; thread_ts?: string }) => {
        uploads.push(args);
        return { ok: true };
      },
    },
  } as unknown as WebClient;

  const run: Run = {
    id: "minute-slack-proof",
    surface: "slack",
    channelId: "C123",
    threadId: "1700000000.000001",
    parentMessageId: "1700000000.000001",
    requesterId: "U123",
    requesterName: "Priya",
    playgroundId: "web",
    request: "green",
    status: "proof",
    branch: "b",
    prUrl: "https://github.com/acme/web/pull/4",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const adapter = slackAdapter(client, { channel: "C123", threadTs: run.threadId });
  const id = await adapter.postProof(
    { caption: "green header", route: "/", filesChanged: ["frontend/src/index.css"], afterPath },
    run,
  );
  assert.equal(id, "1700000000.000100");
  assert.equal(uploads[0]?.filename, "after.png");
  assert.equal(uploads[0]?.thread_ts, run.threadId);
  assert.equal(adapter.mention("U999"), "<@U999>");
  const actions = messages[0]?.blocks?.find((b) => "elements" in b);
  const signed = actions?.elements?.find((el) => el.value)?.value || "";
  assert.equal(parseButton(signed)?.action, "looks_good");
  assert.match(messages[0]?.text || "", /green header/);
});
