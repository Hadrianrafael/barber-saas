import "server-only";
import { env, isConfigured } from "@/env";
import { tts as openAiTts } from "@/server/ai/openai";
import { logger } from "@/lib/logger";

/**
 * Voice provider abstraction for the SDR audio-first outreach.
 *
 * - `openai`   : OpenAI TTS. Default. Works whenever OPENAI_API_KEY is set.
 * - `external` : a generic HTTP TTS endpoint for a custom / cloned voice.
 *               Contract: `POST {EXTERNAL_VOICE_BASE_URL}` with JSON
 *               `{ text, voiceId, format: "mp3" }`, header
 *               `Authorization: Bearer {EXTERNAL_VOICE_API_KEY}`, responding with
 *               `audio/mpeg` bytes. No voice id is invented — it comes from
 *               EXTERNAL_VOICE_ID. If unconfigured, we transparently fall back
 *               to OpenAI TTS so the pipeline never blocks.
 */

export interface SynthesizeArgs {
  text: string;
  /** Overrides the configured voice id (external) / voice name (openai). */
  voice?: string;
  signal?: AbortSignal;
}

export interface SynthesizeResult {
  audio: Buffer;
  contentType: string;
  provider: "openai" | "external";
}

export interface VoiceProvider {
  readonly name: "openai" | "external";
  readonly configured: boolean;
  synthesize(args: SynthesizeArgs): Promise<SynthesizeResult>;
}

const openAiProvider: VoiceProvider = {
  name: "openai",
  get configured() {
    return isConfigured.openai;
  },
  async synthesize({ text, voice, signal }) {
    const audio = await openAiTts({ text, voice, signal });
    return { audio, contentType: "audio/mpeg", provider: "openai" };
  },
};

const externalProvider: VoiceProvider = {
  name: "external",
  get configured() {
    return isConfigured.externalVoice;
  },
  async synthesize({ text, voice, signal }) {
    const res = await fetch(env.EXTERNAL_VOICE_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.EXTERNAL_VOICE_API_KEY}`,
      },
      body: JSON.stringify({
        text,
        voiceId: voice || env.EXTERNAL_VOICE_ID || undefined,
        format: "mp3",
      }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`external voice ${res.status}: ${body.slice(0, 300)}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      contentType: res.headers.get("content-type") ?? "audio/mpeg",
      provider: "external",
    };
  },
};

/** Resolve the active provider, falling back to OpenAI when external is off. */
export function getVoiceProvider(): VoiceProvider {
  if (env.VOICE_PROVIDER === "external") {
    if (externalProvider.configured) return externalProvider;
    logger.warn("voice.external_unconfigured_fallback_openai");
  }
  return openAiProvider;
}

export function voiceStatus() {
  return {
    active: getVoiceProvider().name,
    openaiConfigured: openAiProvider.configured,
    externalConfigured: externalProvider.configured,
    requestedProvider: env.VOICE_PROVIDER,
  };
}
