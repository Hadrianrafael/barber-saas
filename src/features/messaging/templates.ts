import type { MessageChannel } from "@prisma/client";

/**
 * System message templates, per (key, channel, locale). A tenant may override
 * any of these with a `MessageTemplate` row; `renderTemplate` merges the
 * override on top. Variables are `{{name}}` style and HTML-escaped for the
 * e-mail HTML body (plain text / WhatsApp use raw values).
 *
 * Copy is intentionally short — WhatsApp session messages should be concise, and
 * business-initiated WhatsApp outside the 24h window requires a *pre-approved*
 * template on the Meta side anyway (see docs/deployment/whatsapp.md); these
 * strings must then match that approved template's text.
 */

export type TemplateKey =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "appointment_canceled"
  | "appointment_rescheduled"
  | "payment_link"
  | "payment_received"
  | "customer_recovery";

export interface TemplateVars {
  name?: string;
  barbershop?: string;
  barber?: string;
  service?: string;
  datetime?: string;
  price?: string;
  link?: string;
  reason?: string;
}

interface TemplateBody {
  subject?: string;
  text: string;
}

type Locale = "pt-BR" | "en" | "es";

const T: Record<TemplateKey, Record<Locale, TemplateBody>> = {
  appointment_confirmation: {
    "pt-BR": {
      subject: "Agendamento confirmado — {{barbershop}}",
      text: "Olá {{name}}! Seu horário na {{barbershop}} está confirmado: {{service}} com {{barber}} em {{datetime}}.",
    },
    en: {
      subject: "Appointment confirmed — {{barbershop}}",
      text: "Hi {{name}}! Your appointment at {{barbershop}} is confirmed: {{service}} with {{barber}} on {{datetime}}.",
    },
    es: {
      subject: "Cita confirmada — {{barbershop}}",
      text: "¡Hola {{name}}! Tu cita en {{barbershop}} está confirmada: {{service}} con {{barber}} el {{datetime}}.",
    },
  },
  appointment_reminder: {
    "pt-BR": {
      subject: "Lembrete: seu horário na {{barbershop}}",
      text: "Lembrete: {{name}}, você tem {{service}} com {{barber}} na {{barbershop}} em {{datetime}}.",
    },
    en: {
      subject: "Reminder: your appointment at {{barbershop}}",
      text: "Reminder: {{name}}, you have {{service}} with {{barber}} at {{barbershop}} on {{datetime}}.",
    },
    es: {
      subject: "Recordatorio: tu cita en {{barbershop}}",
      text: "Recordatorio: {{name}}, tienes {{service}} con {{barber}} en {{barbershop}} el {{datetime}}.",
    },
  },
  appointment_canceled: {
    "pt-BR": {
      subject: "Agendamento cancelado — {{barbershop}}",
      text: "{{name}}, seu horário de {{service}} em {{datetime}} na {{barbershop}} foi cancelado. {{reason}}",
    },
    en: {
      subject: "Appointment canceled — {{barbershop}}",
      text: "{{name}}, your {{service}} appointment on {{datetime}} at {{barbershop}} was canceled. {{reason}}",
    },
    es: {
      subject: "Cita cancelada — {{barbershop}}",
      text: "{{name}}, tu cita de {{service}} el {{datetime}} en {{barbershop}} fue cancelada. {{reason}}",
    },
  },
  appointment_rescheduled: {
    "pt-BR": {
      subject: "Agendamento remarcado — {{barbershop}}",
      text: "{{name}}, seu horário na {{barbershop}} foi remarcado: {{service}} com {{barber}} agora em {{datetime}}.",
    },
    en: {
      subject: "Appointment rescheduled — {{barbershop}}",
      text: "{{name}}, your appointment at {{barbershop}} was rescheduled: {{service}} with {{barber}} now on {{datetime}}.",
    },
    es: {
      subject: "Cita reprogramada — {{barbershop}}",
      text: "{{name}}, tu cita en {{barbershop}} se reprogramó: {{service}} con {{barber}} ahora el {{datetime}}.",
    },
  },
  payment_link: {
    "pt-BR": {
      subject: "Link de pagamento — {{barbershop}}",
      text: "{{name}}, pague {{price}} referente a {{service}} na {{barbershop}}: {{link}}",
    },
    en: {
      subject: "Payment link — {{barbershop}}",
      text: "{{name}}, pay {{price}} for {{service}} at {{barbershop}}: {{link}}",
    },
    es: {
      subject: "Enlace de pago — {{barbershop}}",
      text: "{{name}}, paga {{price}} por {{service}} en {{barbershop}}: {{link}}",
    },
  },
  payment_received: {
    "pt-BR": {
      subject: "Pagamento recebido — {{barbershop}}",
      text: "{{name}}, recebemos seu pagamento de {{price}} na {{barbershop}}. Obrigado!",
    },
    en: {
      subject: "Payment received — {{barbershop}}",
      text: "{{name}}, we received your {{price}} payment at {{barbershop}}. Thank you!",
    },
    es: {
      subject: "Pago recibido — {{barbershop}}",
      text: "{{name}}, recibimos tu pago de {{price}} en {{barbershop}}. ¡Gracias!",
    },
  },
  customer_recovery: {
    "pt-BR": {
      subject: "Sentimos sua falta na {{barbershop}}",
      text: "{{name}}, faz um tempo desde a sua última visita à {{barbershop}}. Agende: {{link}}",
    },
    en: {
      subject: "We miss you at {{barbershop}}",
      text: "{{name}}, it's been a while since your last visit to {{barbershop}}. Book here: {{link}}",
    },
    es: {
      subject: "Te echamos de menos en {{barbershop}}",
      text: "{{name}}, hace tiempo de tu última visita a {{barbershop}}. Reserva aquí: {{link}}",
    },
  },
};

function normalizeLocale(l: string): Locale {
  return l === "en" || l === "es" ? l : "pt-BR";
}

export function interpolate(tpl: string, vars: TemplateVars): string {
  return tpl
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
      const v = (vars as Record<string, string | undefined>)[k];
      return v == null ? "" : v;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RenderedMessage {
  subject: string | null;
  text: string;
  html: string | null;
}

export interface TenantTemplateOverride {
  subject: string | null;
  body: string;
}

export function renderTemplate(
  key: TemplateKey,
  channel: MessageChannel,
  locale: string,
  vars: TemplateVars,
  override?: TenantTemplateOverride | null,
): RenderedMessage {
  const loc = normalizeLocale(locale);
  const base = T[key][loc];
  const subjectTpl = override?.subject ?? base.subject ?? null;
  const bodyTpl = override?.body ?? base.text;

  const text = interpolate(bodyTpl, vars);
  const subject = subjectTpl ? interpolate(subjectTpl, vars) : null;

  const html =
    channel === "EMAIL"
      ? `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#222">${escapeHtml(
          text,
        )}</div>`
      : null;

  return { subject, text, html };
}
