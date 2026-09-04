import "server-only";
import type { SalesAgentConfig } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { agentConfigSchema } from "./schema";

/**
 * The AI Sales Assistant configuration. The model may ONLY use facts from
 * `knowledge` (services / pricing / differentials / faq) and the per-locale
 * `content` — it must never invent a price, feature or commercial condition.
 * `buildSystemPrompt` bakes that rule in.
 */

export type LocaleContent = {
  tone?: string;
  persona?: string;
  greeting?: string;
  intro?: string;
  pitch?: string;
  cta?: string;
  questions?: string[];
  painPoints?: string[];
  objections?: { q: string; a: string }[];
  offerDemoWhen?: string;
  handoffWhen?: string;
  stopWhen?: string;
  followUps?: { afterHours: number; text: string }[];
};

export type Knowledge = {
  productSummary?: string;
  services?: string[];
  pricing?: { plan: string; price: string; notes?: string }[];
  differentials?: string[];
  faq?: { q: string; a: string }[];
  notes?: string;
};

const DEFAULT_PT: LocaleContent = {
  tone: "cordial, direto e consultivo — nada de robótico",
  persona:
    "Sou um consultor da HR Tech. Ajudo barbearias a organizarem agenda, clientes e financeiro num sistema simples.",
  greeting: "Boa tarde, {{nome}}. Tudo bem?",
  intro:
    "Meu nome é {{assistente}}, da {{empresa}}. Estava conhecendo um pouco a {{barbearia}} e queria saber se posso te roubar uns cinco minutinhos.",
  pitch:
    "A gente tira a agenda do caderno/WhatsApp, organiza os clientes, controla comissão e ainda tem página de agendamento online.",
  cta: "Faz sentido eu te mostrar rapidinho como funciona, sem compromisso?",
  questions: [
    "Quantos barbeiros trabalham hoje na {{barbearia}}?",
    "Vocês usam algum sistema pra agenda ou é no caderno/WhatsApp?",
    "Qual a maior dor hoje: agenda, no-show, controle de caixa ou clientes?",
  ],
  painPoints: ["agenda desorganizada", "no-show", "controle de comissão", "cliente sumido"],
  objections: [
    {
      q: "está caro",
      a: "Entendo. Temos plano a partir do Starter; o retorno costuma vir só reduzindo no-show. Posso te mostrar os números?",
    },
    {
      q: "não tenho tempo",
      a: "A configuração é rápida e a gente te ajuda a migrar. Uns 15 minutos pra começar.",
    },
    {
      q: "já uso outro sistema",
      a: "Legal! O que te incomoda nele hoje? Talvez a gente resolva exatamente isso.",
    },
  ],
  offerDemoWhen: "quando o lead demonstra interesse ou faz 2+ perguntas sobre o produto",
  handoffWhen: "quando o lead pede proposta formal, fala de contrato, ou fica claramente quente",
  stopWhen:
    "quando o lead pede para parar, diz que não tem interesse, ou não responde a 3 follow-ups",
  followUps: [
    { afterHours: 24, text: "Oi {{nome}}, conseguiu ver minha mensagem? Sem pressa 🙂" },
    {
      afterHours: 72,
      text: "{{nome}}, se agora não for o momento tudo bem — te chamo mais pra frente?",
    },
  ],
};

const DEFAULT_KNOWLEDGE: Knowledge = {
  productSummary:
    "SaaS de gestão para barbearias: agenda, clientes (CRM), comissões, financeiro, agendamento público, lembretes por WhatsApp e chatbot de agendamento.",
  services: [
    "Agenda por barbeiro com bloqueios e horários",
    "CRM de clientes com histórico",
    "Comissões (percentual ou fixo)",
    "Página pública de agendamento",
    "Lembretes e mensagens (WhatsApp/e-mail)",
    "Fidelidade e cupons",
  ],
  pricing: [
    { plan: "Starter", price: "consultar no painel", notes: "1 unidade, até 3 barbeiros" },
    { plan: "Pro", price: "consultar no painel", notes: "até 10 barbeiros, WhatsApp e chatbot" },
    { plan: "Scale", price: "consultar no painel", notes: "multi-unidade" },
  ],
  differentials: [
    "Feito para barbearia (não é agenda genérica)",
    "Agendamento público + lembretes reduzem no-show",
    "Chatbot de agendamento incluso nos planos superiores",
  ],
  faq: [
    { q: "Tem fidelidade?", a: "Sim, programa de pontos e recompensas configurável." },
    { q: "Funciona no celular?", a: "Sim, é web e responsivo." },
    { q: "Migra meus clientes?", a: "Sim, importação por CSV/planilha." },
  ],
  notes:
    "NUNCA cite valores em reais específicos — os preços estão nos planos do sistema; direcione para a demonstração.",
};

export async function getActiveAgentConfig(): Promise<SalesAgentConfig> {
  const active = await prisma.salesAgentConfig.findFirst({ where: { isActive: true } });
  if (active) return active;
  const any = await prisma.salesAgentConfig.findFirst({ orderBy: { createdAt: "asc" } });
  if (any) return any;
  return prisma.salesAgentConfig.create({
    data: {
      name: "Assistente de Vendas",
      isActive: true,
      content: { "pt-BR": DEFAULT_PT } as object,
      knowledge: DEFAULT_KNOWLEDGE as object,
      qualificationRules: {
        minBarbers: 1,
        askAbout: ["barbeiros", "sistema atual", "dor principal", "urgência"],
        hotThreshold: 70,
        warmThreshold: 40,
      } as object,
    },
  });
}

export async function listAgentConfigs() {
  return prisma.salesAgentConfig.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function upsertAgentConfig(
  id: string | null,
  input: unknown,
  actorId: string,
): Promise<SalesAgentConfig> {
  const data = agentConfigSchema.parse(input);
  if (id) {
    return prisma.salesAgentConfig.update({
      where: { id },
      data: { ...data, updatedById: actorId },
    });
  }
  return prisma.salesAgentConfig.create({ data: { ...data, updatedById: actorId } });
}

export async function activateAgentConfig(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.salesAgentConfig.updateMany({ data: { isActive: false }, where: {} }),
    prisma.salesAgentConfig.update({ where: { id }, data: { isActive: true } }),
  ]);
}

export function localeContent(cfg: SalesAgentConfig, locale: string): LocaleContent {
  const c = (cfg.content as Record<string, LocaleContent>) ?? {};
  return c[locale] ?? c[cfg.defaultLocale] ?? c["pt-BR"] ?? DEFAULT_PT;
}

export function knowledgeOf(cfg: SalesAgentConfig): Knowledge {
  const k = cfg.knowledge as Knowledge;
  return k && Object.keys(k).length ? k : DEFAULT_KNOWLEDGE;
}

export const DEFAULTS = { pt: DEFAULT_PT, knowledge: DEFAULT_KNOWLEDGE };
