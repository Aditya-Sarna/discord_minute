export type Surface = "discord";

export type RunStatus =
  | "classifying"
  | "working"
  | "proof"
  | "handed_off"
  | "exited"
  | "refused";

export type AttachmentRole = "match" | "spec" | "asset" | "refuse";

export type Run = {
  id: string;
  surface: Surface;
  channelId: string;
  threadId: string;
  parentMessageId: string;
  requesterId: string;
  requesterName: string;
  playgroundId: string;
  request: string;
  originalAsk?: string;
  status: RunStatus;
  branch: string;
  prNumber?: number;
  prUrl?: string;
  workspaceDir?: string;
  lastProofPath?: string;
  lastPhonePath?: string;
  lastProofMessageId?: string;
  statusMessageId?: string;
  iterationCount?: number;
  guildId?: string;
  threadUrl?: string;
  lastSummary?: string;
  lastDiff?: string;
  lastVisualOp?: {
    kind: string;
    target?: string;
    hex?: string;
    size?: string;
    file?: string;
    summary: string;
  };
  attachmentNotes?: string[];
  pendingAttachments?: Attachment[];
  kind?: "tweak" | "scratch" | "ask";
  scratchName?: string;
  scratchGithub?: { owner: string; repo: string; defaultBranch: string };
  askGithub?: {
    owner: string;
    repo: string;
    defaultBranch: string;
    ref?: string;
    path?: string;
    pr?: number;
    description?: string;
  };
  createdAt: string;
  updatedAt: string;
  exitReason?: string;
};

export type Playground = {
  id: string;
  discordChannelIds: string[];
  github: {
    owner: string;
    repo: string;
    defaultBranch: string;
  };
  preview: {
    baseUrl: string;
    command: string;
    cwd: string;
    url: string;
    waitSeconds: number;
    defaultRoute: string;
    install: boolean;
    installTimeoutSeconds: number;
  };
  allow: {
    paths: string[];
    routes: string[];
  };
  refuse: string[];
};

export type MinuteConfig = {
  name: string;
  admins: {
    discordUserIds: string[];
    githubLogins: string[];
  };
  requesters: {
    discordUserIds: string[];
  };
  tech: {
    discordUserIds: string[];
  };
  playgrounds: Playground[];
};

export type Attachment = {
  name: string;
  url: string;
  localPath?: string;
  role?: AttachmentRole;
  contentType?: string;
};

export type Proof = {
  beforePath?: string;
  afterPath?: string;
  phonePath?: string;
  caption: string;
  route: string;
  filesChanged: string[];
  skippedReason?: string;
  using?: string[];
};

export type ClassifyResult =
  | { ok: true; route: string; summary: string }
  | { ok: false; reason: string };
