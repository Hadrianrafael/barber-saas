import "server-only";
import type { SalesAgentConfig, SalesLead } from "@prisma/client";
import { chat } from "@/server/ai/openai";
import { isConfigured } from "@/env";
import { logger } from "@/lib/logger";
import { getActiveAgentConfig, knowledgeOf, localeContent, type Knowledge, type LocaleContent } from "./agent-config";
import { buildModelContext, renderTemplate } from "./conversation";
import { detectOptOut } from "./suppression";

/**
 * The SDR "brain". It composes a STRICT system prompt from the agent
 * configuration + knowledge base and asks the model for the next reply.
 *
 * Hard rule baked into the prompt: the model may only state facts that appear in
 * the knowledge base. It must never invent a price, feature, discount, deadline
 * or any commercial condition — when asked something not covered, it either asks
 * a qualifying question or offers a demo / human follow-up.
 */

export type AgentTurn = {
  reply: string;
  wantsHandoff: boolean;
  wantsStop: boolean;
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
  usedFallback: boolean;
};

const HANDOFF_MARK = "[[HANDOFF]]";
const STOP_MARK = "[[STOP]]";

function knowledgeBlock(k: Knowledge): string {
  const lines: string[] = [];
  if (k.productSummary) lines.push(`Produto: ${k.productSummary}`);
  if (k.services?.length) lines.push(`Recursos:\n- ${k.services.join("\n- ")}`);
  if (k.pricing?.length) {
    lines.push(
      `Planos (NÃO cite valores em dinheiro; se não houver valor explícito aqui, diga que os valores estão no painel e ofereça a demonstração):\n` +
        k.pricing.map((p) => `- ${p.plan}: ${p.price}${p.notes ? ` (${p.notes})` : ""}`).join("\n"),
    );
  }
  if (k.differentials?.length) lines.push(`Diferenciais:\n- ${k.differentials.join("\n- ")}`);
  if (k.faq?.length) lines.push(`FAQ:\n${k.faq.map((f) => `P: ${f.q}\nR: ${f.a}`).join("\n")}`);
  if (k.notes) lines.push(`Observações internas: ${k.notes}`);
  return lines.join("\n\n");
}

function contentBlock(c: LocaleContent, vars: Record<string, string | undefined>): string {
  const lines: string[] = [];
  if (c.persona) lines.push(`Persona: ${c.persona}`);
  if (c.tone) lines.push(`Tom: ${c.tone}`);
  if (c.pitch) lines.push(`Pitch curto: ${renderTemplate(c.pitch, vars)}`);
  if (c.cta) lines.push(`CTA: ${renderTemplate(c.cta, vars)}`);
  if (c.questions?.length)
    lines.push(`Perguntas de qualificação:\n- ${c.questions.map((q) => renderTemplate(q, vars)).join("\n- ")}`);
  if (c.objections?.length)
    lines.push(
      `Objeções e respostas aprovadas:\n${c.objections.map((o) => `- "${o.q}" → ${o.a}`).join("\n")}`,
    );
  if (c.offerDemoWhen) lines.push(`Ofereça demonstração: ${c.offerDemoWhen}`);
  if (c.handoffWhen) lines.push(`Passe para humano (responda com ${HANDOFF_MARK} no fim): ${c.handoffWhen}`);
  if (c.stopWhen) lines.push(`Encerre educadamente (responda com ${STOP_MARK} no fim): ${c.stopWhen}`);
  return lines.join("\n");
}

export function buildSystemPrompt(
  cfg: SalesAgentConfig,
  lead: Pick<SalesLead, "name" | "barbershopName" | "city">,
  locale: string,
): string {
  const c = localeContent(cfg, locale);
  const k = knowledgeOf(cfg);
  const vars = {
    nome: lead.name ?? "",
    assistente: cfg.assistantName,
    empresa: cfg.companyName,
    barbearia: lead.barbershopName ?? "",
    cidade: lead.city ?? "",
  };

  if (cfg.systemPromptOverride && cfg.systemPromptOverride.trim().length > 0) {
    return `${renderTemplate(cfg.systemPromptOverride, vars)}

BASE DE CONHECIMENTO (única fonte de fatos — não invente nada fora disto):
${knowledgeBlock(k)}`;
  }

  return `Você é ${cfg.assistantName}, consultor(a) de vendas da ${cfg.companyName}. Você prospecta barbearias para apresentar um SaaS de gestão.
Idioma da conversa: ${locale}. Fale como uma pessoa real no WhatsApp: mensagens curtas, no máximo 2 frases, sem parecer script. Uma pergunta por vez.

REGRAS INEGOCIÁVEIS:
1. NUNCA invente preço, valor em dinheiro, desconto, prazo, funcionalidade, integração ou condição comercial. Use SOMENTE os fatos da BASE DE CONHECIMENTO abaixo.
2. Se perguntarem algo que não está na base, diga que confirma isso na demonstração / com o time e siga com uma pergunta de qualificação.
3. Não prometa resultado garantido. Não fale mal de concorrentes por nome.
4. Respeite quem não quer ser contatado: se a pessoa pedir para parar, encerre com ${STOP_MARK}.
5. Se a pessoa pedir proposta formal, contrato, ligar, ou demonstrar claro interesse de compra, encerre a mensagem com ${HANDOFF_MARK} para um humano assumir.
6. Nunca revele que você é uma IA a menos que perguntem diretamente; se perguntarem, seja honesto e ofereça encaminhar para uma pessoa.

CONTEXTO DO LEAD:
- Nome: ${vars.nome || "(desconhecido)"}
- Barbearia: ${vars.barbearia || "(desconhecida)"}
- Cidade: ${vars.cidade || "(desconhecida)"}

CONFIGURAÇÃO DE ABORDAGEM:
${contentBlock(c, vars)}

BASE DE CONHECIMENTO (única fonte de fatos — não invente nada fora disto):
${knowledgeBlock(k)}`;
}

/** Deterministic fallback when OpenAI is not configured (keeps TEST MODE usable). */
function fallbackReply(
  cfg: SalesAgentConfig,
  lead: Pick<SalesLead, "name" | "barbershopName" | "city">,
  locale: string,
  inbound: string,
): AgentTurn {
  const c = localeContent(cfg, locale);
  const vars = { nome: lead.name ?? "", assistente: cfg.assistantName, empresa: cfg.companyName, barbearia: lead.barbershopName ?? "" };
  const stop = detectOptOut(inbound);
  const reply = stop
    ? "Sem problema, vou encerrar por aqui. Se quiser retomar é só me chamar. Abraço!"
    : renderTemplate(c.questions?.[0] ?? c.cta ?? "Posso te mostrar como funciona, sem compromisso?", vars);
  return {
    reply,
    wantsHandoff: false,
    wantsStop: stop,
    tokensIn: 0,
    tokensOut: 0,
    costMicroUsd: 0,
    usedFallback: true,
  };
}

export async function runAgentTurn(args: {
  conversationId: string;
  lead: Pick<SalesLead, "name" | "barbershopName" | "city">;
  inboundText: string;
  locale?: string;
  config?: SalesAgentConfig;
  signal?: AbortSignal;
}): Promise<AgentTurn> {
  const cfg = args.config ?? (await getActiveAgentConfig());
  const locale = args.locale ?? cfg.defaultLocale ?? "pt-BR";

  if (!isConfigured.openai) {
    return fallbackReply(cfg, args.lead, locale, args.inboundText);
  }

  const systemPrompt = buildSystemPrompt(cfg, args.lead, locale);
  const messages = await buildModelContext(args.conversationId, systemPrompt);

  try {
    const res = await chat({
      messages,
      temperature: 0.6,
      maxTokens: 220,
      signal: args.signal,
    });
    let reply = res.text.trim();
    const wantsHandoff = reply.includes(HANDOFF_MARK);
    const wantsStop = reply.includes(STOP_MARK) || detectOptOut(args.inboundText);
    reply = reply.replace(HANDOFF_MARK, "").replace(STOP_MARK, "").trim();
    return {
      reply: reply || fallbackReply(cfg, args.lead, locale, args.inboundText).reply,
      wantsHandoff,
      wantsStop,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costMicroUsd: res.costMicroUsd,
      usedFallback: false,
    };
  } catch (e) {
    logger.error({ err: (e as Error).message, conversationId: args.conversationId }, "sdr.agent.turn_failed");
    return fallbackReply(cfg, args.lead, locale, args.inboundText);
  }
}
