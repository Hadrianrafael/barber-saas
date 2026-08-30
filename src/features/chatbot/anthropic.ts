import "server-only";
import { env, isConfigured } from "@/env";

/**
 * Minimal Anthropic Messages API client (no SDK dependency). Env-gated: throws
 * `ChatbotNotConfiguredError` when `ANTHROPIC_API_KEY` is unset — callers must
 * check `isConfigured.chatbot` and degrade to the human queue, never fake a
 * reply.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class ChatbotNotConfiguredError extends Error {
  constructor() {
    super("chatbot not configured (ANTHROPIC_API_KEY missing)");
    this.name = "ChatbotNotConfiguredError";
  }
}
export class ChatbotApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatbotApiError";
    this.status = status;
  }
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | string;
  content: ContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
}

export async function callAnthropic(args: {
  system: string;
  messages: AnthropicMessage[];
  tools?: AnthropicToolDef[];
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<AnthropicResponse> {
  if (!isConfigured.chatbot) throw new ChatbotNotConfiguredError();

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: env.CHATBOT_MODEL,
      max_tokens: args.maxTokens ?? 1024,
      system: args.system,
      messages: args.messages,
      ...(args.tools?.length ? { tools: args.tools } : {}),
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ChatbotApiError(res.status, `anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as AnthropicResponse;
}
