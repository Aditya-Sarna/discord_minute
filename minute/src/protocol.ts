import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { playgroundForChannel, playgroundForRun, repoLabel, techIds } from "./config.js";
import { classifyRequest } from "./classify.js";
import { applySmallestChange } from "./agent.js";
import { stakeholderError } from "./errors.js";
import {
  diffFromDefault,
  ensureAskWorkspace,
  ensureWorkspace,
  commitAll,
  pushBranch,
  pushMinuteBranch,
  pruneWorkspace,
  revertLastMinuteCommit,
  worktreeDirty,
} from "./git.js";
import { commentProof, createScratchRepo, inspectGithubRepo, openPr, prBody, titleFromChange, updatePr } from "./github.js";
import { captureAfter, captureBefore } from "./preview.js";
import { claimRun, getRun, newRunId, saveRun } from "./store.js";
import { log } from "./logger.js";
import { LIMITS } from "./limits.js";
import { llmConfigured } from "./llm.js";
import { attachmentPromptBlock, applyRole, inferAttachRole, type ClassifiedAttachment } from "./attachments.js";
import { fetchScratchPhotos } from "./photos.js";
import {
  answerRepoQuestion,
  inferRunKind,
  parseGithubUrl,
  parseShowFileAsk,
  questionFromAsk,
  repoTreeSketch,
  selectRepoFiles,
  looksLikeWhereLive,
  snippetFromRepo,
} from "./ask.js";
import { parseShowMobile, parseUndo, type LastVisualOp } from "./simple-edit.js";
import { classifyScratch, parseScratchIntent, scratchRepoName, writeScratchApp } from "./scratch.js";
import type { ChatAdapter } from "./surfaces/types.js";
import type { Attachment, Playground, Proof, Run, Surface } from "./types.js";

function techMentions(surface: Surface, adapter: ChatAdapter): string {
  const ids = techIds(surface);
  if (!ids.length) return "tech";
  return ids.map((id) => adapter.mention(id)).join(" ");
}

async function status(run: Run, chat: ChatAdapter, text: string) {
  await chat.setTyping();
  run.statusMessageId = await chat.postOrUpdateStatus(text, run.statusMessageId);
  saveRun(run);
}

export function createRunDraft(opts: {
  surface: Surface;
  channelId: string;
  threadId: string;
  parentMessageId: string;
  requesterId: string;
  requesterName: string;
  playgroundId: string;
  text: string;
  guildId?: string;
  threadUrl?: string;
  kind?: "tweak" | "scratch" | "ask";
  scratchName?: string;
}): Run {
  const id = newRunId();
  const run: Run = {
    id,
    surface: opts.surface,
    channelId: opts.channelId,
    threadId: opts.threadId,
    parentMessageId: opts.parentMessageId,
    requesterId: opts.requesterId,
    requesterName: opts.requesterName,
    playgroundId: opts.playgroundId,
    request: opts.text,
    originalAsk: opts.text,
    status: "classifying",
    branch: id,
    kind: opts.kind,
    scratchName: opts.scratchName,
    guildId: opts.guildId,
    threadUrl: opts.threadUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return saveRun(run);
}

function classifyIncoming(attachments: Attachment[] | undefined, text: string): ClassifiedAttachment[] {
  if (!attachments?.length) return [];
  const role = inferAttachRole(text, attachments.map((a) => a.name));
  if (role === "need_intent" || role === "refuse") {
    return applyRole(attachments, role === "refuse" ? "refuse" : "match");
  }
  return applyRole(attachments, role);
}

export async function startRun(opts: {
  run: Run;
  attachments?: Attachment[];
  chat: ChatAdapter;
}): Promise<Run> {
  const run = getRun(opts.run.id) ?? opts.run;
  const base = playgroundForChannel(run.surface, run.channelId) ?? playgroundForRun(run);
  if (!base) {
    await opts.chat.postRefuse(
      "This channel isn’t a Minute playground. Ask an admin to wire it.",
    );
    run.status = "refused";
    run.exitReason = "no playground";
    saveRun(run);
    return run;
  }
  if (!llmConfigured() && run.kind !== "scratch") {
    await opts.chat.postRefuse("Minute isn’t configured — Ollama isn’t set up.");
    run.status = "refused";
    saveRun(run);
    return run;
  }
  if (!process.env.GITHUB_TOKEN) {
    await opts.chat.postRefuse("Minute isn’t configured — missing GITHUB_TOKEN.");
    run.status = "refused";
    saveRun(run);
    return run;
  }

  const classified = classifyIncoming(opts.attachments, run.request);
  if (classified.some((c) => c.role === "refuse")) {
    await opts.chat.postRefuse("I can’t use that file type. Drop an image, PDF, doc, or a logo.");
    run.status = "refused";
    saveRun(run);
    return run;
  }
  const using = classified.map((c) => c.name);
  if (using.length) {
    run.attachmentNotes = [
      ...(run.attachmentNotes ?? []),
      ...classified.map((c) => `${c.name} (${c.role})`),
    ];
  }

  run.kind = inferRunKind(run.request, base, run.kind);
  saveRun(run);

  await status(
    run,
    opts.chat,
    run.kind === "ask"
      ? "Reading the repo…"
      : using.length
        ? `Using ${using.join(", ")}. On it — photo incoming.`
        : `On it — photo incoming.`,
  );

  try {
    if (run.kind === "ask") {
      // Q&A is allowed to go into implementation detail. Do not run the visual gate.
    } else if (run.kind === "scratch") {
      const gate = classifyScratch(run.request + attachmentPromptBlock(classified), base);
      if (!gate.ok) {
        run.status = "refused";
        run.exitReason = gate.reason;
        saveRun(run);
        await opts.chat.postRefuse(gate.reason);
        return run;
      }
      if (!run.scratchGithub) {
        await status(run, opts.chat, "Creating a new GitHub repo…");
        const created = await createScratchRepo({
          owner: base.github.owner,
          name: scratchRepoName(run.request, run.scratchName),
          description: run.request,
        });
        run.scratchGithub = {
          owner: created.owner,
          repo: created.repo,
          defaultBranch: created.defaultBranch,
        };
        saveRun(run);
      }
    } else {
      const gate = await classifyRequest(run.request + attachmentPromptBlock(classified), base);
      if (!gate.ok) {
        run.status = "refused";
        run.exitReason = gate.reason;
        saveRun(run);
        await opts.chat.postRefuse(gate.reason);
        return run;
      }
    }

    const playground = playgroundForRun(run) ?? base;
    run.status = "working";
    saveRun(run);
    if (run.kind === "ask") {
      await executeAsk(run, opts.chat, run.request);
      return getRun(run.id) ?? run;
    }
    await status(
      run,
      opts.chat,
      run.kind === "scratch" ? `New repo · ${repoLabel(playground)}.` : `Working · ${repoLabel(playground)}.`,
    );
    await executeChange(run, playground, opts.chat, {
      request: run.request,
      route: playground.preview.defaultRoute || "/",
      attachments: classified,
    });
    return getRun(run.id) ?? run;
  } catch (err) {
    log.error({ err, runId: run.id }, "startRun failed");
    run.status = "exited";
    run.exitReason = err instanceof Error ? err.message : String(err);
    saveRun(run);
    await opts.chat.postRefuse(
      `Couldn’t finish this Minute: ${stakeholderError(run.exitReason || "")}. Ping tech if you still need it.`,
    );
    return run;
  }
}

export async function iterateRun(opts: {
  run: Run;
  text: string;
  attachments?: Attachment[];
  chat: ChatAdapter;
}): Promise<void> {
  const current = getRun(opts.run.id) ?? opts.run;
  const claimed =
    current.status === "working" ? current : claimRun(opts.run.id, "proof", "working");
  if (!claimed || claimed.status !== "working") return;
  const playground = playgroundForRun(claimed);
  if (!playground) return;

  if (claimed.kind !== "ask" && parseUndo(opts.text)) {
    await executeUndo(claimed, playground, opts.chat);
    return;
  }
  if (claimed.kind !== "ask" && parseShowMobile(opts.text)) {
    await executeMobile(claimed, playground, opts.chat);
    return;
  }

  const nextCount = (claimed.iterationCount ?? 0) + 1;
  if (nextCount > LIMITS.iterations) {
    claimed.status = "proof";
    saveRun(claimed);
    await opts.chat.postRefuse(
      `That’s enough tweaks for this Minute. Say looks good, or ping tech.`,
    );
    return;
  }
  claimed.iterationCount = nextCount;
  claimed.request = `${claimed.request}\n\nTweak: ${opts.text}`;
  const classified = classifyIncoming(opts.attachments, opts.text);
  if (classified.length) {
    claimed.attachmentNotes = [
      ...(claimed.attachmentNotes ?? []),
      ...classified.map((c) => `${c.name} (${c.role})`),
    ];
  }
  saveRun(claimed);
  if (claimed.kind === "ask") {
    await status(claimed, opts.chat, "Answering…");
    try {
      await executeAsk(claimed, opts.chat, opts.text);
    } catch (err) {
      log.error({ err, runId: claimed.id }, "ask iterate failed");
      claimed.status = "proof";
      saveRun(claimed);
      await opts.chat.postRefuse(
        `Couldn’t answer that: ${stakeholderError(err instanceof Error ? err.message : String(err))}. Try a tighter question.`,
      );
    }
    return;
  }
  await status(claimed, opts.chat, "Updating the same change…");

  try {
    await executeChange(claimed, playground, opts.chat, {
      request: opts.text,
      prior: claimed.request,
      attachments: classified,
      iterate: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, runId: claimed.id }, "iterate failed");
    claimed.status = "proof";
    saveRun(claimed);
    if (/EMPTY_CHANGE|No files changed|didn't edit anything/i.test(message)) {
      await opts.chat.postRefuse("I didn’t change anything. Try a more specific reply — or undo, or cancel.");
      return;
    }
    await opts.chat.postRefuse(
      `Couldn’t apply that tweak: ${stakeholderError(message)}. Try a simpler reply, or cancel.`,
    );
  }
}

export async function handoffRun(run: Run, chat: ChatAdapter): Promise<void> {
  const claimed = claimRun(run.id, "proof", "handed_off");
  if (!claimed) {
    await chat.postOrUpdateStatus("Nothing to hand off yet.", run.statusMessageId);
    return;
  }
  if (claimed.kind === "ask") {
    claimed.status = "exited";
    claimed.exitReason = "Done.";
    saveRun(claimed);
    await chat.postExit("That’s it for this repo thread. Paste another GitHub link anytime.");
    await chat.lockThread();
    await pruneWorkspace(claimed.id);
    return;
  }
  const playground = playgroundForRun(claimed);
  if (!playground || !claimed.prNumber) {
    claimed.status = "proof";
    saveRun(claimed);
    await chat.postRefuse("No PR yet.");
    return;
  }

  const proof: Proof = {
    caption: claimed.lastSummary || "Visual sign-off",
    route: playground.preview.defaultRoute,
    filesChanged: [],
    afterPath: claimed.lastProofPath,
    phonePath: claimed.lastPhonePath,
  };
  const body = prBody({
    playground,
    run: claimed,
    summary: claimed.lastSummary || "Stakeholder signed off visually.",
    proof,
    signedOff: true,
    diff: claimed.lastDiff,
  });
  await updatePr(playground, claimed.prNumber, {
    title: titleFromChange(claimed.lastSummary || "signed off"),
    body,
  });
  if (claimed.lastProofPath) {
    const raw = `https://github.com/${playground.github.owner}/${playground.github.repo}/blob/${claimed.branch}/.minute/${claimed.id}-after.png?raw=true`;
    await commentProof(
      playground,
      claimed.prNumber,
      proof,
      `**Visual sign-off by ${claimed.requesterName}.**\n\n![after](${raw})`,
    );
  }

  await chat.stampSignedOff(
    claimed.lastProofMessageId,
    `${claimed.requesterName} signed off.`,
  );
  await status(claimed, chat, "Handed to tech.");
  await chat.postHandoff(claimed, techMentions(claimed.surface, chat));
  await chat.lockThread();
  await pruneWorkspace(claimed.id);
}

export async function cancelRun(run: Run, chat: ChatAdapter, reason?: string): Promise<void> {
  const current = getRun(run.id) ?? run;
  if (current.status === "exited" || current.status === "refused") return;
  current.status = "exited";
  current.exitReason = reason || "Cancelled.";
  saveRun(current);
  await chat.disableProofButtons(current.lastProofMessageId);
  await chat.postExit(current.exitReason);
  await chat.lockThread();
  await pruneWorkspace(current.id);
}

export async function exitFromGithub(
  run: Run,
  chat: ChatAdapter,
  kind: "changes_requested" | "closed",
): Promise<void> {
  const current = getRun(run.id) ?? run;
  if (current.status !== "handed_off") return;
  const reason =
    kind === "closed"
      ? "PR was closed without merge. Minute is done — talk to each other if you still need this."
      : "Tech disapproved (changes requested). Minute is done. Talk it through and improve the PR by hand if it isn’t architecturally feasible.";
  current.status = "exited";
  current.exitReason = reason;
  saveRun(current);
  await chat.postExit(reason);
  await chat.lockThread();
  await pruneWorkspace(current.id);
}

export async function mergedFromGithub(run: Run, chat: ChatAdapter): Promise<void> {
  const current = getRun(run.id) ?? run;
  if (current.status !== "handed_off") return;
  current.status = "exited";
  current.exitReason = "Merged.";
  saveRun(current);
  await chat.postOrUpdateStatus("Merged. Minute is done.", current.statusMessageId);
  await chat.lockThread();
  await pruneWorkspace(current.id);
}

async function executeAsk(run: Run, chat: ChatAdapter, text: string) {
  const fromText = parseGithubUrl(text) || parseGithubUrl(run.originalAsk || run.request);
  const prev = run.askGithub;
  const owner = fromText?.owner || prev?.owner;
  const repo = fromText?.repo || prev?.repo;
  if (!owner || !repo) {
    throw new Error("Paste a GitHub link (github.com/owner/repo) with your question.");
  }

  await status(run, chat, `Reading ${owner}/${repo}…`);
  const switched =
    !prev ||
    prev.owner !== owner ||
    prev.repo !== repo ||
    (fromText?.pr && fromText.pr !== prev.pr) ||
    (fromText?.ref && fromText.ref !== prev.ref);
  if (switched) {
    await pruneWorkspace(run.id);
    const meta = await inspectGithubRepo(owner, repo);
    run.askGithub = {
      owner: meta.owner,
      repo: meta.repo,
      defaultBranch: meta.defaultBranch,
      description: meta.description,
      ref: fromText?.ref,
      path: fromText?.path,
      pr: fromText?.pr,
    };
    saveRun(run);
    run.workspaceDir = await ensureAskWorkspace({
      runId: run.id,
      owner: meta.owner,
      repo: meta.repo,
      ref: fromText?.ref || meta.defaultBranch,
      pr: fromText?.pr,
    });
    saveRun(run);
  }

  const dir = run.workspaceDir;
  if (!dir) throw new Error("Couldn’t clone that GitHub repo.");
  const question = questionFromAsk(text);

  const showPath = parseShowFileAsk(question);
  if (showPath) {
    const snippet = snippetFromRepo(dir, showPath);
    run.lastSummary = question;
    run.status = "proof";
    saveRun(run);
    await chat.postAnswer(snippet || `I can’t see \`${showPath}\` in this clone.`, {
      title: `${owner}/${repo}`,
      footer: "Reply to ask more — Minute does not edit on an ask thread",
    });
    return;
  }
  if (looksLikeWhereLive(question)) {
    const files = selectRepoFiles(dir, question, run.askGithub?.path, 4);
    const top = files[0];
    run.lastSummary = question;
    run.status = "proof";
    saveRun(run);
    await chat.postAnswer(
      top
        ? `**Where this would live**\n\`${top.path}\` — start here if you switch to a visual tweak. Minute does not edit on an ask thread.`
        : "I cloned the repo but couldn’t match a file for that change.",
      {
        title: `${owner}/${repo}`,
        footer: "Reply to ask more, or start a tweak Minute to change it",
      },
    );
    return;
  }

  const files = selectRepoFiles(dir, question, run.askGithub?.path);
  await status(run, chat, "Answering…");
  const answer = await answerRepoQuestion({
    question,
    repoLabel: `${owner}/${repo}`,
    description: run.askGithub?.description,
    tree: repoTreeSketch(dir),
    files,
  });
  run.lastSummary = question;
  run.status = "proof";
  saveRun(run);
  await chat.postAnswer(answer, {
    title: `${owner}/${repo}`,
    footer: "Reply in the thread to ask more about this repo",
  });
}

async function executeChange(
  run: Run,
  playground: Playground,
  chat: ChatAdapter,
  opts: {
    request: string;
    prior?: string;
    route?: string;
    attachments?: ClassifiedAttachment[];
    iterate?: boolean;
  },
) {
  await status(run, chat, run.kind === "scratch" ? "Cloning the new repo…" : "Cloning the playground…");
  const dir = await ensureWorkspace({
    runId: run.id,
    playground,
    branch: run.branch,
    createBranch: !opts.iterate,
  });
  run.workspaceDir = dir;
  saveRun(run);

  const route = opts.route || playground.preview.defaultRoute || "/";
  const before = opts.iterate ? undefined : await captureBefore(run.id, playground, route);

  await status(run, chat, run.kind === "scratch" && !opts.iterate ? "Building the first version…" : "Editing…");
  let result: { files: string[]; summary: string; routeHint?: string; lastOp?: LastVisualOp };
  if (run.kind === "scratch" && !opts.iterate) {
    const ask = run.originalAsk || run.request;
    const intent = parseScratchIntent(ask, run.scratchName);
    await status(run, chat, "Fetching photos…");
    const photos = await fetchScratchPhotos(dir, {
      theme: intent.theme,
      request: ask,
      attachments: opts.attachments,
    });
    result = writeScratchApp(dir, ask, run.scratchName, { photos });
  } else {
    result = await applySmallestChange({
      root: dir,
      playground,
      request: opts.request + attachmentPromptBlock(opts.attachments ?? []),
      prior: opts.prior,
      attachments: opts.attachments,
      lastOp: run.lastVisualOp as LastVisualOp | undefined,
    });
    if (result.lastOp) run.lastVisualOp = result.lastOp;
    saveRun(run);
    if (!(await worktreeDirty(dir))) {
      throw new Error("EMPTY_CHANGE");
    }
  }

  await status(run, chat, "Taking a photo of the change…");
  const after = await captureAfter({
    runId: run.id,
    playground,
    workspaceDir: dir,
    route: result.routeHint || route,
    onStatus: (text) => status(run, chat, text),
  });

  if (after.path) {
    const destDir = join(dir, ".minute");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(after.path, join(destDir, `${run.id}-after.png`));
    if (after.phonePath) copyFileSync(after.phonePath, join(destDir, `${run.id}-after-phone.png`));
    if (before) copyFileSync(before, join(destDir, `${run.id}-before.png`));
  }

  await commitAll(dir, `minute: ${result.summary}`);
  const diff = await diffFromDefault(dir, playground.github.defaultBranch);
  await status(run, chat, "Opening the PR…");
  await pushBranch(dir, run.branch);

  const using = opts.attachments?.map((a) => a.name);
  const proof: Proof = {
    beforePath: before,
    afterPath: after.path,
    phonePath: after.phonePath,
    caption: result.summary,
    route: result.routeHint || route,
    filesChanged: result.files.filter((f) => !f.startsWith(".minute/")),
    skippedReason: after.skippedReason,
    using,
  };
  run.lastProofPath = after.path;
  run.lastPhonePath = after.phonePath;
  run.lastSummary = result.summary;
  run.lastDiff = diff;
  saveRun(run);

  const body = prBody({
    playground,
    run,
    summary: result.summary,
    proof,
    signedOff: false,
    diff,
  });
  const title = titleFromChange(result.summary);

  if (!run.prNumber) {
    const pr = await openPr({ playground, run, title, body });
    run.prNumber = pr.number;
    run.prUrl = pr.url;
  } else {
    await updatePr(playground, run.prNumber, { title, body });
  }

  run.status = "proof";
  saveRun(run);
  let proofId: string | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      proofId = await chat.postProof(proof, run);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      log.warn({ err, attempt, runId: run.id }, "postProof retry");
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  if (lastErr) throw lastErr;
  run.lastProofMessageId = proofId;
  saveRun(run);
}

async function executeMobile(run: Run, playground: Playground, chat: ChatAdapter) {
  if (!run.lastPhonePath) {
    run.status = "proof";
    saveRun(run);
    await chat.postRefuse("I don’t have a phone photo yet. Reply with a tweak first.");
    return;
  }
  const proof: Proof = {
    caption: "Phone",
    route: playground.preview.defaultRoute || "/",
    filesChanged: [],
    afterPath: run.lastPhonePath,
    phonePath: run.lastPhonePath,
  };
  run.status = "proof";
  saveRun(run);
  run.lastProofMessageId = await chat.postProof(proof, run);
  saveRun(run);
}

async function executeUndo(run: Run, playground: Playground, chat: ChatAdapter) {
  await status(run, chat, "Undoing the last tweak…");
  const dir = await ensureWorkspace({
    runId: run.id,
    playground,
    branch: run.branch,
    createBranch: false,
  });
  run.workspaceDir = dir;
  saveRun(run);
  const ok = await revertLastMinuteCommit(dir);
  if (!ok) {
    run.status = "proof";
    saveRun(run);
    await chat.postRefuse("Nothing to undo — this is the first version.");
    return;
  }
  await status(run, chat, "Taking a photo of the prior state…");
  const after = await captureAfter({
    runId: run.id,
    playground,
    workspaceDir: dir,
    route: playground.preview.defaultRoute || "/",
    onStatus: (text) => status(run, chat, text),
  });
  if (after.path) {
    const destDir = join(dir, ".minute");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(after.path, join(destDir, `${run.id}-after.png`));
    if (after.phonePath) copyFileSync(after.phonePath, join(destDir, `${run.id}-after-phone.png`));
  }
  await pushMinuteBranch(dir, run.branch, true);
  const diff = await diffFromDefault(dir, playground.github.defaultBranch);
  run.lastProofPath = after.path;
  run.lastPhonePath = after.phonePath;
  run.lastSummary = "undid last tweak";
  run.lastDiff = diff;
  run.lastVisualOp = undefined;
  saveRun(run);
  if (run.prNumber) {
    await updatePr(playground, run.prNumber, {
      title: titleFromChange("undid last tweak"),
      body: prBody({
        playground,
        run,
        summary: "Undid the last tweak.",
        proof: {
          caption: "Undid the last tweak",
          route: playground.preview.defaultRoute || "/",
          filesChanged: [],
          afterPath: after.path,
          phonePath: after.phonePath,
          skippedReason: after.skippedReason,
        },
        signedOff: false,
        diff,
      }),
    });
  }
  run.status = "proof";
  saveRun(run);
  run.lastProofMessageId = await chat.postProof(
    {
      caption: "Undid the last tweak",
      route: playground.preview.defaultRoute || "/",
      filesChanged: [],
      afterPath: after.path,
      phonePath: after.phonePath,
      skippedReason: after.skippedReason,
    },
    run,
  );
  saveRun(run);
}
