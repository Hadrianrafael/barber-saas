import "server-only";
import { env, isConfigured } from "@/env";
import { sendEmail } from "@/server/mail";

export class MessagingNotConfiguredError extends Error {
  channel: string;
  constructor(channel: string) {
    super(`${channel} channel is not configured`);
    this.name = "MessagingNotConfiguredError";
    this.channel = channel;
  }
}
export class MessagingSendError extends Error {
  retriable: boolean;
  constructor(message: string, retriable = true) {
    super(message);
    this.name = "MessagingSendError";
    this.retriable = retriable;
  }
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendViaEmail(
  p: EmailPayload,
): Promise<{ providerMessageId: string | null; provider: string }> {
  // sendEmail routes to Resend when configured, else a dev console transport.
  const res = await sendEmail({ to: p.to, subject: p.subject, html: p.html, text: p.text });
  return { providerMessageId: res.id, provider: isConfigured.resend ? "resend" : "console" };
}

export interface WhatsAppPayload {
  to: string; // E.164 digits, no '+'
  text: string;
}

/**
 * WhatsApp Business Platform — Meta Cloud API. Session (free-form) text message.
 * Business-initiated messages outside the 24h customer-service window require a
 * pre-approved template (`type: "template"`) — see docs/deployment/whatsapp.md.
 */
export async function sendViaWhatsApp(
  p: WhatsAppPayload,
): Promise<{ providerMessageId: string; provider: string }> {
  if (!isConfigured.whatsapp) throw new MessagingNotConfiguredError("whatsapp");

  const to = p.to.replace(/[^\d]/g, "");
  const url = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: true, body: p.text.slice(0, 4096) },
      }),
    });
  } catch (e) {
    throw new MessagingSendError(`whatsapp network error: ${(e as Error).message}`, true);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    // 4xx (bad number, not opted in, template required) → not retriable; 5xx/429 → retriable.
    const retriable = res.status >= 500 || res.status === 429;
    throw new MessagingSendError(`whatsapp ${res.status}: ${bodyText.slice(0, 300)}`, retriable);
  }
  let json: { messages?: { id: string }[] };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new MessagingSendError("whatsapp: unparseable response", true);
  }
  const id = json.messages?.[0]?.id;
  if (!id) throw new MessagingSendError("whatsapp: no message id in response", true);
  return { providerMessageId: id, provider: "whatsapp_cloud" };
}
