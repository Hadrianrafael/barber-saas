import "server-only";
import { Resend } from "resend";
import { env, isConfigured } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Transactional e-mail.
 *
 * If RESEND_API_KEY is set → Resend. Otherwise a console transport logs the
 * message so local/dev flows still work end-to-end without pretending delivery
 * happened. Multilingual bodies are the caller's responsibility (templates land
 * in Slice 8); helpers below cover the auth flows.
 */

const resend = isConfigured.resend ? new Resend(env.RESEND_API_KEY) : null;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string | null }> {
  if (!resend) {
    logger.info(
      { to: input.to, subject: input.subject, transport: "console" },
      "[mail] (dev console transport) e-mail not sent — RESEND_API_KEY missing",
    );
    logger.debug({ body: input.text ?? input.html }, "[mail] body");
    return { id: null };
  }

  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo,
  });

  if (error) {
    logger.error({ err: error, to: input.to }, "[mail] send failed");
    throw new Error(`E-mail delivery failed: ${error.message}`);
  }
  return { id: data?.id ?? null };
}

// --- Auth flow helpers -----------------------------------------------------

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;margin:0;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
      <tr><td style="font-size:18px;font-weight:600;color:#111">${title}</td></tr>
      <tr><td style="padding-top:16px;font-size:14px;line-height:1.6;color:#444">${bodyHtml}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const T = {
  verify: {
    "pt-BR": {
      subject: "Confirme o seu e-mail",
      title: "Confirmação de e-mail",
      body: (url: string) =>
        `Bem-vindo! Confirme o seu e-mail para ativar a sua conta.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Confirmar e-mail</a><br><br>Se você não criou esta conta, ignore este e-mail.`,
    },
    en: {
      subject: "Confirm your email",
      title: "Email confirmation",
      body: (url: string) =>
        `Welcome! Confirm your email to activate your account.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Confirm email</a><br><br>If you didn't create this account, ignore this email.`,
    },
    es: {
      subject: "Confirma tu correo",
      title: "Confirmación de correo",
      body: (url: string) =>
        `¡Bienvenido! Confirma tu correo para activar tu cuenta.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Confirmar correo</a><br><br>Si no creaste esta cuenta, ignora este mensaje.`,
    },
  },
  reset: {
    "pt-BR": {
      subject: "Redefinição de senha",
      title: "Redefinir senha",
      body: (url: string) =>
        `Recebemos um pedido para redefinir a sua senha.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Definir nova senha</a><br><br>O link expira em 1 hora. Se não foi você, ignore este e-mail.`,
    },
    en: {
      subject: "Password reset",
      title: "Reset password",
      body: (url: string) =>
        `We received a request to reset your password.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Set new password</a><br><br>The link expires in 1 hour. If this wasn't you, ignore this email.`,
    },
    es: {
      subject: "Restablecer contraseña",
      title: "Restablecer contraseña",
      body: (url: string) =>
        `Recibimos una solicitud para restablecer tu contraseña.<br><br><a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Definir nueva contraseña</a><br><br>El enlace caduca en 1 hora. Si no fuiste tú, ignora este mensaje.`,
    },
  },
} as const;

type AuthLocale = keyof (typeof T)["verify"];
const pick = (l: string): AuthLocale => (l === "en" || l === "es" ? l : "pt-BR");

export async function sendVerificationEmail(to: string, url: string, locale: string) {
  const t = T.verify[pick(locale)];
  return sendEmail({
    to,
    subject: t.subject,
    html: layout(t.title, t.body(url)),
    text: `${t.title}\n\n${url}`,
  });
}

export async function sendPasswordResetEmail(to: string, url: string, locale: string) {
  const t = T.reset[pick(locale)];
  return sendEmail({
    to,
    subject: t.subject,
    html: layout(t.title, t.body(url)),
    text: `${t.title}\n\n${url}`,
  });
}
