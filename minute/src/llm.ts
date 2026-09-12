import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { log } from "./logger.js";

export function ollamaBase(): string {
  return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export function ollamaModel(): string {
  return process.env.MINUTE_LLM_MODEL || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
}

export function llmBackend(): "ollama" | "proxy" | "anthropic" | "openai" {
  const raw = (process.env.MINUTE_LLM_BACKEND || "ollama").toLowerCase();
  if (raw === "proxy" || raw === "anthropic" || raw === "openai") return raw;
  return "ollama";
}

export async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export function llmConfigured(): boolean {
  const backend = llmBackend();
  if (backend === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (backend === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (backend === "proxy") return Boolean(process.env.MINUTE_LLM_PROXY_URL);
  return true;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|rate|timeout|529|503|overloaded/i.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const wait = 500 * 2 ** i;
      log.warn({ err, wait }, "llm retry");
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

function connRefused(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: string }).code)
      : "";
  return code === "ECONNREFUSED" || /fetch failed/i.test(err instanceof Error ? err.message : String(err));
}

async function viaOllama(
  prompt: string,
  opts?: { maxTokens?: number; system?: string; json?: boolean },
): Promise<string> {
  const base = ollamaBase();
  const model = ollamaModel();
  const messages: { role: string; content: string }[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: opts?.json ? "json" : undefined,
        options: { num_predict: opts?.maxTokens ?? 8000, temperature: opts?.json ? 0 : 0.2 },
      }),
    });
  } catch (err) {
    if (connRefused(err)) {
      throw new Error(
        `Ollama is not running at ${base}. Install it and run: ollama serve && ollama pull ${model}`,
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as { message?: { content?: string }; response?: string };
  return data.message?.content ?? data.response ?? "";
}

async function viaProxy(prompt: string, opts?: { maxTokens?: number; system?: string }): Promise<string> {
  const base = process.env.MINUTE_LLM_PROXY_URL!.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/api/llm/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_tokens: opts?.maxTokens ?? 8000,
        system: opts?.system,
      }),
    });
  } catch (err) {
    if (connRefused(err)) {
      throw new Error(`LLM proxy is not running at ${base}.`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (!res.ok) throw new Error(`LLM proxy ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

export async function complete(
  prompt: string,
  opts?: { maxTokens?: number; system?: string; json?: boolean },
): Promise<string> {
  const model = process.env.MINUTE_LLM_MODEL;
  const backend = llmBackend();
  return withRetry(async () => {
    if (backend === "proxy") return viaProxy(prompt, opts);
    if (backend === "anthropic") {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new Error("Set ANTHROPIC_API_KEY");
      const client = new Anthropic({ apiKey: anthropicKey });
      const res = await client.messages.create({
        model: model || "claude-sonnet-4-5-20250929",
        max_tokens: opts?.maxTokens ?? 8000,
        system: opts?.system,
        messages: [{ role: "user", content: prompt }],
      });
      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text : "";
    }
    if (backend === "openai") {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) throw new Error("Set OPENAI_API_KEY");
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.chat.completions.create({
        model: model || "gpt-4.1",
        messages: [
          ...(opts?.system ? [{ role: "system" as const, content: opts.system }] : []),
          { role: "user", content: prompt },
        ],
        max_tokens: opts?.maxTokens ?? 8000,
      });
      return res.choices[0]?.message?.content ?? "";
    }
    return viaOllama(prompt, opts);
  });
}

export async function completeJson<T>(prompt: string, opts?: { maxTokens?: number }): Promise<T> {
  const ask = `${prompt}

Reply with JSON only. No markdown.`;
  let text = await complete(ask, {
    ...opts,
    json: true,
    system: "You output a single JSON object. No markdown fences, no commentary.",
  });
  try {
    return JSON.parse(extractJson(text)) as T;
  } catch {
    text = await complete(`${ask}\n\nYour previous reply was not valid JSON. Return JSON only.`, {
      ...opts,
      json: true,
      system: "You output a single JSON object. No markdown fences, no commentary.",
    });
    return JSON.parse(extractJson(text)) as T;
  }
}
