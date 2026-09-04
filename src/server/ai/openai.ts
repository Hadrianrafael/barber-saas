import "server-only";
import { env, isConfigured } from "@/env";

/**
 * Minimal OpenAI client (no SDK). Used only by the platform SDR / AI Sales
 * Assistant. Env-gated: throws `OpenAiNotConfiguredError` when `OPENAI_API_KEY`
 * is unset — callers MUST check `isConfigured.openai` and degrade (queue for a
 * human, never fake a reply).
 */

const BASE = "https://api.openai.com/v1";

export class OpenAiNotConfiguredError extends Error {
  constructor() {
    super("OpenAI not configured (OPENAI_API_KEY missing)");
    this.name = "OpenAiNotConfiguredError";
  }
}
export class OpenAiApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAiApiError";
    this.status = status;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Estimated cost in millionths of USD (very rough, model-dependent). */
  costMicroUsd: number;
}

// Rough price table (USD per 1M tokens) — used only for the dashboard estimate.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["gpt-4o-mini"]!;
  return Math.round((tokensIn * p.in + tokensOut * p.out) / 1); // (tokens/1e6)*price*1e6 == tokens*price
}

export async function chat(args: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  if (!isConfigured.openai) throw new OpenAiNotConfiguredError();
  const model = args.model ?? env.OPENAI_MODEL;

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: args.messages,
      temperature: args.temperature ?? 0.5,
      max_tokens: args.maxTokens ?? 600,
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiApiError(res.status, `openai ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const text = json.choices[0]?.message?.content?.trim() ?? "";
  const tokensIn = json.usage?.prompt_tokens ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;
  return { text, tokensIn, tokensOut, costMicroUsd: estimateCost(model, tokensIn, tokensOut) };
}

export interface TranscriptResult {
  text: string;
  language?: string;
}

/** Transcribe an audio buffer (ogg/opus, mp3, m4a, wav...) via Whisper. */
export async function transcribe(args: {
  audio: Buffer | Uint8Array;
  filename?: string;
  contentType?: string;
  signal?: AbortSignal;
}): Promise<TranscriptResult> {
  if (!isConfigured.openai) throw new OpenAiNotConfiguredError();

  const form = new FormData();
  const blob = new Blob([Buffer.from(args.audio)], {
    type: args.contentType ?? "audio/ogg",
  });
  form.append("file", blob, args.filename ?? "audio.ogg");
  form.append("model", env.OPENAI_TRANSCRIBE_MODEL);
  form.append("response_format", "json");

  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: args.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiApiError(res.status, `openai transcribe ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as { text: string; language?: string };
  return { text: (json.text ?? "").trim(), language: json.language };
}

/** OpenAI text-to-speech. Returns MP3 bytes. */
export async function tts(args: {
  text: string;
  voice?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<Buffer> {
  if (!isConfigured.openai) throw new OpenAiNotConfiguredError();
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: args.model ?? env.OPENAI_TTS_MODEL,
      voice: args.voice ?? env.OPENAI_TTS_VOICE,
      input: args.text,
      response_format: "mp3",
    }),
    signal: args.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiApiError(res.status, `openai tts ${res.status}: ${body.slice(0, 500)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
