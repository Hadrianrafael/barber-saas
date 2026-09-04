import { z } from "zod";

export const SDR_LEAD_FIELDS = [
  "name",
  "barbershopName",
  "phone",
  "whatsapp",
  "email",
  "city",
  "state",
  "website",
  "instagram",
  "notes",
  "source",
  "tags",
  "status",
] as const;
export type SdrLeadField = (typeof SDR_LEAD_FIELDS)[number];

export const LEAD_STATUSES = [
  "NOVO",
  "ABORDADO",
  "CONVERSANDO",
  "QUALIFICANDO",
  "INTERESSADO",
  "DEMONSTRACAO",
  "HUMANO",
  "SEM_INTERESSE",
  "OPT_OUT",
] as const;

/** Spreadsheet-header aliases (lowercased, trimmed) → our field. */
export const HEADER_ALIASES: Record<string, SdrLeadField> = {
  name: "name",
  nome: "name",
  contato: "name",
  responsavel: "name",
  "nome do contato": "name",
  barbearia: "barbershopName",
  "nome da barbearia": "barbershopName",
  empresa: "barbershopName",
  negocio: "barbershopName",
  business: "barbershopName",
  shop: "barbershopName",
  phone: "phone",
  telefone: "phone",
  fone: "phone",
  celular: "phone",
  tel: "phone",
  whatsapp: "whatsapp",
  whats: "whatsapp",
  wpp: "whatsapp",
  zap: "whatsapp",
  email: "email",
  "e-mail": "email",
  mail: "email",
  correo: "email",
  cidade: "city",
  city: "city",
  municipio: "city",
  estado: "state",
  state: "state",
  uf: "state",
  site: "website",
  website: "website",
  url: "website",
  "pagina web": "website",
  instagram: "instagram",
  insta: "instagram",
  ig: "instagram",
  "perfil instagram": "instagram",
  observacoes: "notes",
  observacao: "notes",
  obs: "notes",
  notes: "notes",
  notas: "notes",
  comentarios: "notes",
  origem: "source",
  source: "source",
  fonte: "source",
  canal: "source",
  tags: "tags",
  etiquetas: "tags",
  marcadores: "tags",
  status: "status",
  situacao: "status",
  etapa: "status",
};

export function autoMap(headers: string[]): (SdrLeadField | null)[] {
  return headers.map((h) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, " ");
    return HEADER_ALIASES[key] ?? null;
  });
}

export const importCommitSchema = z.object({
  importId: z.string().min(1),
  mapping: z.array(z.enum([...SDR_LEAD_FIELDS] as [SdrLeadField, ...SdrLeadField[]]).nullable()),
  defaultSource: z.string().max(120).optional(),
  defaultTags: z.array(z.string().max(40)).max(20).optional(),
});

export const leadUpdateSchema = z.object({
  name: z.string().max(160).optional().nullable(),
  barbershopName: z.string().max(200).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(80).optional().nullable(),
  website: z.string().max(300).optional().nullable(),
  instagram: z.string().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  status: z.enum([...LEAD_STATUSES] as [string, ...string[]]).optional(),
  consentBasis: z
    .enum(["OPT_IN", "LEGITIMATE_INTEREST", "EXISTING_RELATIONSHIP"])
    .nullable()
    .optional(),
  consentNote: z.string().max(500).optional().nullable(),
});

export const campaignCreateSchema = z.object({
  name: z.string().min(2).max(120),
  channel: z.enum(["WHATSAPP", "EMAIL"]).default("WHATSAPP"),
  firstTouch: z.enum(["AUDIO", "TEXT"]).default("AUDIO"),
  locale: z.enum(["pt-BR", "en", "es"]).default("pt-BR"),
  agentConfigId: z.string().optional().nullable(),
  dailyCap: z.coerce.number().int().min(1).max(500).default(30),
  minIntervalSec: z.coerce.number().int().min(20).max(3600).default(180),
  jitterPct: z.coerce.number().int().min(0).max(80).default(40),
  windowStartMin: z.coerce.number().int().min(0).max(1439).default(540),
  windowEndMin: z.coerce.number().int().min(1).max(1440).default(1140),
  sendDays: z.array(z.coerce.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
  timezone: z.string().max(64).default("America/Sao_Paulo"),
  templateName: z.string().max(120).optional().nullable(),
});

export const agentConfigSchema = z.object({
  name: z.string().min(2).max(120),
  assistantName: z.string().min(1).max(80),
  companyName: z.string().min(1).max(120),
  replyMode: z.enum(["TEXT", "AUDIO", "MIXED"]).default("MIXED"),
  defaultLocale: z.enum(["pt-BR", "en", "es"]).default("pt-BR"),
  content: z.record(z.any()).default({}),
  knowledge: z.record(z.any()).default({}),
  qualificationRules: z.record(z.any()).default({}),
  systemPromptOverride: z.string().max(8000).optional().nullable(),
});
