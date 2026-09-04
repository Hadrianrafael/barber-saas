import "server-only";
import type { SalesLead, SalesAgentConfig } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { chat } from "@/server/ai/openai";
import { isConfigured } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Automatic lead qualification. After each inbound turn we extract structured
 * signals from the conversation and roll them into a 0-100 score → FRIO / MORNO
 * / QUENTE. QUENTE (or an explicit ask) pauses the AI and flags for a human.
 */

export type QualSignals = {
  barbers?: number | null;
  currentSystem?: string | null;
  mainPain?: string | null;
  interest?: "low" | "medium" | "high" | null;
  budgetSignal?: "none" | "some" | "clear" | null;
  urgency?: "none" | "soon" | "now" | null;
  wantsDemo?: boolean;
  wantsHuman?: boolean;
  wantsStop?: boolean;
};

export type QualResult = {
  signals: QualSignals;
  score: number;
  tier: "FRIO" | "MORNO" | "QUENTE";
};

const EXTRACT_SYSTEM = `Você extrai sinais de qualificação de uma conversa de vendas de um SaaS para barbearias.
Responda APENAS um JSON válido com as chaves:
{"barbers": number|null, "currentSystem": string|null, "mainPain": string|null,
 "interest": "low"|"medium"|"high"|null, "budgetSignal": "none"|"some"|"clear"|null,
 "urgency": "none"|"soon"|"now"|null, "wantsDemo": boolean, "wantsHuman": boolean, "wantsStop": boolean}
Não invente. Use null quando não houver informação. wantsHuman=true se o lead pedir proposta/contrato/falar com pessoa.
wantsStop=true se pedir para parar / sem interesse.`;

function heuristicSignals(text: string): QualSignals {
  const t = text.toLowerCase();
  const barbersMatch = t.match(/(\d{1,3})\s*(barbeiro|barber|cadeira|profiss)/);
  return {
    barbers: barbersMatch ? Number(barbersMatch[1]) : null,
    currentSystem: /(caderno|papel|whats)/.test(t) ? "manual/whatsapp" : null,
    mainPain: null,
    interest: /(quero|interessado|me manda|gostei|como funciona|quanto)/.test(t)
      ? "high"
      : /(talvez|depois|pode ser)/.test(t)
        ? "medium"
        : null,
    budgetSignal: /(quanto custa|pre[cç]o|valor|plano)/.test(t) ? "some" : null,
    urgency: /(hoje|agora|essa semana|urgente)/.test(t) ? "now" : null,
    wantsDemo: /(demonstra|mostrar|apresenta|ver funcionando)/.test(t),
    wantsHuman: /(proposta|contrato|falar com|liga pra mim|humano|atendente)/.test(t),
    wantsStop: false,
  };
}

export function scoreSignals(s: QualSignals, cfg?: SalesAgentConfig): QualResult {
  let score = 0;
  if (s.interest === "high") score += 30;
  else if (s.interest === "medium") score += 12;
  if (s.wantsDemo) score += 20;
  if (s.budgetSignal === "clear") score += 20;
  else if (s.budgetSignal === "some") score += 8;
  if (s.urgency === "now") score += 15;
  else if (s.urgency === "soon") score += 8;
  if (typeof s.barbers === "number" && s.barbers >= 1) score += 8;
  if (s.currentSystem) score += 4;
  if (s.wantsHuman) score += 25;
  score = Math.max(0, Math.min(100, score));

  const rules = (cfg?.qualificationRules ?? {}) as {
    hotThreshold?: number;
    warmThreshold?: number;
  };
  const hot = rules.hotThreshold ?? 70;
  const warm = rules.warmThreshold ?? 40;
  const tier = score >= hot ? "QUENTE" : score >= warm ? "MORNO" : "FRIO";
  return { signals: s, score, tier };
}

export async function qualifyFromTranscript(
  transcript: string,
  cfg?: SalesAgentConfig,
  signal?: AbortSignal,
): Promise<QualResult> {
  let signals: QualSignals = heuristicSignals(transcript);
  if (isConfigured.openai) {
    try {
      const res = await chat({
        temperature: 0,
        maxTokens: 200,
        messages: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: transcript.slice(-6000) },
        ],
        signal,
      });
      const json = JSON.parse(res.text.replace(/^```json\s*|\s*```$/g, "")) as QualSignals;
      signals = { ...signals, ...json };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "sdr.qualify.extract_failed");
    }
  }
  return scoreSignals(signals, cfg);
}

/** Persist a qualification result on the lead + emit an event. */
export async function applyQualification(leadId: string, r: QualResult): Promise<SalesLead> {
  const lead = await prisma.salesLead.update({
    where: { id: leadId },
    data: {
      qualification: r.tier,
      score: r.score,
      qualData: r.signals as object,
      ...(r.tier === "QUENTE" || r.signals.wantsHuman ? { status: "HUMANO" } : {}),
    },
  });
  await prisma.salesLeadEvent.create({
    data: { leadId, kind: "qualified", data: { score: r.score, tier: r.tier } },
  });
  return lead;
}
