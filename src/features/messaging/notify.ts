import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { formatMoney } from "@/lib/utils";
import { canContact, type Channel } from "./consent";
import { renderTemplate, type TemplateKey, type TemplateVars } from "./templates";
import { sendMessage } from "./dispatch";

/** Channels to try, in order, for a transactional customer notification. */
async function pickChannels(customerId: string): Promise<Channel[]> {
  const out: Channel[] = [];
  for (const ch of ["WHATSAPP", "EMAIL"] as Channel[]) {
    const c = await canContact(customerId, ch, "transactional");
    if (c.ok) out.push(ch);
  }
  return out;
}

function fmtDateTime(instant: Date, locale: string, tz: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  }).format(instant);
}

async function loadTenantTemplate(tenantId: string, key: string, channel: string, locale: string) {
  const row = await prisma.messageTemplate.findFirst({
    where: { tenantId, key, channel: channel as never, locale },
    select: { subject: true, body: true },
  });
  return row ? { subject: row.subject, body: row.body } : null;
}

/**
 * Sends an appointment-related notification to the customer on their best
 * available consented channel. Called from the scheduling worker job (never
 * inline in the request path) and from payment-link creation.
 */
export async function notifyAppointment(
  appointmentId: string,
  key: TemplateKey,
  extra: Partial<TemplateVars> = {},
): Promise<{ sent: number }> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      tenant: { select: { id: true, name: true, timezone: true } },
      customer: { select: { id: true, name: true, locale: true } },
      employee: { select: { name: true } },
    },
  });
  if (!appt || !appt.customer) return { sent: 0 };

  const locale = appt.customer.locale || "pt-BR";
  const vars: TemplateVars = {
    name: appt.customer.name,
    barbershop: appt.tenant.name,
    barber: appt.employee.name,
    service: appt.serviceName,
    datetime: fmtDateTime(appt.startsAt, locale, appt.tenant.timezone),
    price: formatMoney(appt.priceCents, appt.currency, locale),
    ...extra,
  };

  const channels = await pickChannels(appt.customer.id);
  let sent = 0;
  for (const channel of channels) {
    const override = await loadTenantTemplate(appt.tenant.id, key, channel, locale);
    const r = renderTemplate(key, channel, locale, vars, override);
    const to = await addressFor(appt.customer.id, channel);
    if (!to) continue;
    const msg = await sendMessage({
      tenantId: appt.tenant.id,
      customerId: appt.customer.id,
      channel,
      templateKey: key,
      category: "transactional",
      locale,
      to,
      subject: r.subject,
      text: channel === "EMAIL" ? (r.html ?? r.text) : r.text,
    });
    // One channel is enough — stop once a channel actually accepted it.
    if (msg?.status === "SENT") {
      sent += 1;
      break;
    }
  }
  if (sent === 0) logger.info({ appointmentId, key }, "notify.no_channel_delivered");
  return { sent };
}

/** Notifies a customer about a payment link on their best consented channel. */
export async function notifyPaymentLink(paymentLinkId: string): Promise<{ sent: number }> {
  const link = await prisma.paymentLink.findUnique({
    where: { id: paymentLinkId },
    include: {
      tenant: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, locale: true } },
    },
  });
  if (!link || !link.customer || !link.url) return { sent: 0 };

  const locale = link.customer.locale || "pt-BR";
  const vars: TemplateVars = {
    name: link.customer.name,
    barbershop: link.tenant.name,
    service: link.description,
    price: formatMoney(link.amountCents, link.currency, locale),
    link: link.url,
  };
  const channels = await pickChannels(link.customer.id);
  for (const channel of channels) {
    const override = await loadTenantTemplate(link.tenant.id, "payment_link", channel, locale);
    const r = renderTemplate("payment_link", channel, locale, vars, override);
    const to = await addressFor(link.customer.id, channel);
    if (!to) continue;
    await sendMessage({
      tenantId: link.tenant.id,
      customerId: link.customer.id,
      channel,
      templateKey: "payment_link",
      category: "transactional",
      locale,
      to,
      subject: r.subject,
      text: channel === "EMAIL" ? (r.html ?? r.text) : r.text,
    });
    return { sent: 1 };
  }
  return { sent: 0 };
}

async function addressFor(customerId: string, channel: Channel): Promise<string | null> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true, phone: true, whatsapp: true },
  });
  if (!c) return null;
  if (channel === "EMAIL") return c.email;
  return c.whatsapp ?? c.phone;
}
