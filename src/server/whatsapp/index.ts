import "server-only";
import { env, isConfigured } from "@/env";

/**
 * WhatsApp Business Platform — Meta Cloud API. Full surface used by the SDR
 * module: send text, send audio (upload media → send by id), send template,
 * download inbound media, mark read. Official API only — no WhatsApp Web
 * automation.
 *
 * Env-gated. Callers check `isConfigured.whatsapp` first; unconfigured ⇒ the
 * SDR runs in a no-send mode and everything is logged as `FAILED`/skipped.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super("WhatsApp not configured");
    this.name = "WhatsAppNotConfiguredError";
  }
}
export class WhatsAppApiError extends Error {
  status: number;
  retriable: boolean;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.retriable = status >= 500 || status === 429;
  }
}

function assertConfigured() {
  if (!isConfigured.whatsapp) throw new WhatsAppNotConfiguredError();
}
function authHeaders() {
  return { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` };
}
function normalizeTo(to: string) {
  return to.replace(/[^\d]/g, "");
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new WhatsAppApiError(res.status, `whatsapp ${res.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function sendText(to: string, body: string): Promise<{ id: string }> {
  assertConfigured();
  const json = await post(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeTo(to),
    type: "text",
    text: { preview_url: true, body: body.slice(0, 4096) },
  });
  const id = (json.messages as { id: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppApiError(502, "whatsapp: no message id");
  return { id };
}

export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components?: unknown[],
): Promise<{ id: string }> {
  assertConfigured();
  const json = await post(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    to: normalizeTo(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components?.length ? { components } : {}),
    },
  });
  const id = (json.messages as { id: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppApiError(502, "whatsapp: no message id");
  return { id };
}

/** Upload media bytes, returning the media id for a subsequent send. */
export async function uploadMedia(
  bytes: Buffer | Uint8Array,
  contentType: string,
  filename = "audio.mp3",
): Promise<string> {
  assertConfigured();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", contentType);
  form.append("file", new Blob([Buffer.from(bytes)], { type: contentType }), filename);
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new WhatsAppApiError(res.status, `whatsapp media ${res.status}: ${text.slice(0, 300)}`);
  const id = (JSON.parse(text) as { id?: string }).id;
  if (!id) throw new WhatsAppApiError(502, "whatsapp: no media id");
  return id;
}

export async function sendAudioById(to: string, mediaId: string): Promise<{ id: string }> {
  assertConfigured();
  const json = await post(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeTo(to),
    type: "audio",
    audio: { id: mediaId },
  });
  const id = (json.messages as { id: string }[] | undefined)?.[0]?.id;
  if (!id) throw new WhatsAppApiError(502, "whatsapp: no message id");
  return { id };
}

/** Convenience: upload + send audio in one call. */
export async function sendAudio(
  to: string,
  bytes: Buffer | Uint8Array,
  contentType = "audio/mpeg",
): Promise<{ id: string; mediaId: string }> {
  const mediaId = await uploadMedia(bytes, contentType);
  const { id } = await sendAudioById(to, mediaId);
  return { id, mediaId };
}

/** Fetch and download inbound media by its id. */
export async function downloadMedia(
  mediaId: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  assertConfigured();
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: authHeaders() });
  if (!metaRes.ok) {
    throw new WhatsAppApiError(metaRes.status, `whatsapp media meta ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { url: string; mime_type?: string };
  const binRes = await fetch(meta.url, { headers: authHeaders() });
  if (!binRes.ok) {
    throw new WhatsAppApiError(binRes.status, `whatsapp media download ${binRes.status}`);
  }
  return {
    bytes: Buffer.from(await binRes.arrayBuffer()),
    contentType: meta.mime_type ?? binRes.headers.get("content-type") ?? "audio/ogg",
  };
}

export async function markRead(messageId: string): Promise<void> {
  assertConfigured();
  await post(`${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => undefined); // best-effort
}
