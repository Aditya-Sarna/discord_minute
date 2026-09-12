import type { Proof, Run } from "../types.js";

export type Chip = { customId: string; label: string };

export type ChatAdapter = {
  mention: (userId: string) => string;
  postOrUpdateStatus: (text: string, messageId?: string) => Promise<string | undefined>;
  postRefuse: (reason: string) => Promise<void>;
  postAnswer: (text: string, opts?: { title?: string; footer?: string }) => Promise<void>;
  postProof: (proof: Proof, run: Run) => Promise<string | undefined>;
  postHandoff: (run: Run, techMentions: string) => Promise<void>;
  postExit: (reason: string) => Promise<void>;
  disableProofButtons: (messageId?: string) => Promise<void>;
  stampSignedOff: (messageId: string | undefined, line: string) => Promise<void>;
  lockThread: () => Promise<void>;
  askWithChips: (question: string, chips: Chip[]) => Promise<void>;
  setTyping: () => Promise<void>;
};
