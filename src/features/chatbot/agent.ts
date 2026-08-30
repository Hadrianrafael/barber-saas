import "server-only";
import { logger } from "@/lib/logger";
import { callAnthropic, type AnthropicMessage, type ContentBlock } from "./anthropic";
import { CHATBOT_TOOLS, runTool, type ChatToolContext } from "./tools";

const MAX_STEPS = 6;
const TIMEOUT_MS = 30_000;

export interface AgentTurn {
  /** Final assistant text to show the customer. */
  reply: string;
  /** Structured trace to persist as ConversationMessage rows. */
  steps: {
    role: "assistant" | "tool";
    content: string;
    toolName?: string;
    toolPayload?: unknown;
  }[];
  handedOff: boolean;
}

function systemPrompt(args: {
  tenantName: string;
  locale: string;
  todayISO: string;
  timezone: string;
  instructions: string;
}): string {
  return [
    `You are the booking assistant for "${args.tenantName}", a barbershop.`,
    `Today is ${args.todayISO} (${args.timezone}). The customer's language looks like "${args.locale}" — always reply in the customer's language (pt-BR, English or Spanish).`,
    "",
    "STRICT RULES:",
    "- Never invent prices, durations, availability, barbers, services or policies. Get every such fact from a tool call first.",
    "- Only ever act for the person you are chatting with. Call identify_customer (name + email or phone) before booking, listing or changing their appointments.",
    "- You can only view/cancel/reschedule appointments that belong to that identified customer.",
    "- You cannot access other customers, finances, staff management or shop settings. If asked, offer to hand off to a human.",
    "- Confirm the service, date, time and barber back to the customer before calling book_appointment.",
    "- If a tool returns an error, explain it plainly and suggest an alternative or a human handoff. Do not retry blindly.",
    "- Keep replies short and friendly. Never expose internal ids to the customer.",
    args.instructions ? `\nShop-specific notes:\n${args.instructions}` : "",
  ].join("\n");
}

/** Rebuild the Anthropic message list from stored conversation history. */
export function toAnthropicMessages(
  history: { role: string; content: string }[],
): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of history) {
    if (m.role === "customer") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant" || m.role === "agent")
      out.push({ role: "assistant", content: m.content });
    // tool / system rows are not replayed to the model (kept for the panel only)
  }
  // The model requires the first message to be from the user.
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

export async function runAgentTurn(args: {
  ctx: ChatToolContext;
  tenantName: string;
  timezone: string;
  instructions: string;
  history: { role: string; content: string }[];
  userText: string;
}): Promise<AgentTurn> {
  const { ctx } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const messages = toAnthropicMessages(args.history);
  messages.push({ role: "user", content: args.userText });

  const system = systemPrompt({
    tenantName: args.tenantName,
    locale: ctx.locale,
    todayISO: new Intl.DateTimeFormat("en-CA", { timeZone: args.timezone }).format(new Date()),
    timezone: args.timezone,
    instructions: args.instructions,
  });

  const steps: AgentTurn["steps"] = [];
  let handedOff = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await callAnthropic({
        system,
        messages,
        tools: CHATBOT_TOOLS,
        signal: controller.signal,
      });

      const textParts = res.content.filter(
        (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
      );
      const toolUses = res.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      const assistantText = textParts
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (assistantText) steps.push({ role: "assistant", content: assistantText });

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        return { reply: assistantText || fallbackReply(ctx.locale), steps, handedOff };
      }

      // Echo the assistant's tool-call turn back, then run the tools.
      messages.push({ role: "assistant", content: res.content });
      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name, tu.input, ctx);
        if (out.handedOff) handedOff = true;
        steps.push({
          role: "tool",
          content: JSON.stringify(out),
          toolName: tu.name,
          toolPayload: { input: tu.input, output: out },
        });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out),
          is_error: typeof out.error === "string",
        });
      }
      messages.push({ role: "user", content: results });
    }

    // Ran out of steps.
    return { reply: fallbackReply(ctx.locale), steps, handedOff };
  } catch (e) {
    logger.warn(
      { err: (e as Error).message, conversationId: ctx.conversationId },
      "chatbot.turn_failed",
    );
    return { reply: fallbackReply(ctx.locale), steps, handedOff: true };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackReply(locale: string): string {
  if (locale.startsWith("es"))
    return "Perdona, no pude completar eso ahora. Un miembro del equipo continuará contigo.";
  if (locale.startsWith("en"))
    return "Sorry, I couldn't complete that right now. A team member will follow up with you.";
  return "Desculpe, não consegui concluir agora. Um atendente vai continuar com você.";
}
