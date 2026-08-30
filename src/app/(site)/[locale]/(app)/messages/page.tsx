import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { MessageChannel, MessageStatus } from "@prisma/client";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { AuthorizationError } from "@/server/rbac/guard";
import { listMessages } from "@/features/messaging/log";
import { MessagesFilter } from "@/features/messaging/components/messages-filter";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ channel?: string; status?: string; page?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  // Communication log — managers+ (uses conversation.read as the closest scope).
  if (!roleCan(active.role, "conversation.read")) throw new AuthorizationError();

  const t = await getTranslations("messagesLog");
  const page = Math.max(1, Number(sp.page) || 1);
  const channel = ["EMAIL", "WHATSAPP", "SMS", "IN_APP"].includes(sp.channel ?? "")
    ? (sp.channel as MessageChannel)
    : undefined;
  const status = ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "BOUNCED"].includes(
    sp.status ?? "",
  )
    ? (sp.status as MessageStatus)
    : undefined;

  const data = await listMessages(active.tenantId, { channel, status, page });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>

      <MessagesFilter channel={sp.channel ?? ""} status={sp.status ?? ""} counts={data.counts} />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("when")}</th>
              <th className="p-3">{t("channel")}</th>
              <th className="p-3">{t("to")}</th>
              <th className="p-3">{t("preview")}</th>
              <th className="p-3">{t("status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            )}
            {data.rows.map((m) => (
              <tr key={m.id}>
                <td className="p-3 text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString(locale)}
                </td>
                <td className="p-3">
                  {t(`ch.${m.channel}`)}{" "}
                  {m.direction === "INBOUND" && (
                    <span className="text-xs text-muted-foreground">↓</span>
                  )}
                </td>
                <td className="p-3 text-muted-foreground">{m.toAddress}</td>
                <td className="p-3">
                  <span className="line-clamp-2 max-w-md text-muted-foreground">
                    {m.subject ? `${m.subject} — ` : ""}
                    {m.body.replace(/<[^>]+>/g, "").slice(0, 140)}
                  </span>
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      m.status === "FAILED" || m.status === "BOUNCED"
                        ? "bg-red-100 text-red-800"
                        : m.status === "READ" || m.status === "DELIVERED"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-muted"
                    }`}
                    title={m.error ?? undefined}
                  >
                    {t(`st.${m.status}`)}
                    {m.attempts > 1 ? ` ·${m.attempts}` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t("count", { total: String(data.total) })}</span>
        <div className="flex items-center gap-2">
          <Link
            href={`?channel=${sp.channel ?? ""}&status=${sp.status ?? ""}&page=${page - 1}`}
            aria-disabled={page <= 1}
            className={page <= 1 ? "pointer-events-none opacity-40" : "underline"}
          >
            {t("prev")}
          </Link>
          <span>
            {page} / {Math.max(1, data.pages)}
          </span>
          <Link
            href={`?channel=${sp.channel ?? ""}&status=${sp.status ?? ""}&page=${page + 1}`}
            aria-disabled={page >= data.pages}
            className={page >= data.pages ? "pointer-events-none opacity-40" : "underline"}
          >
            {t("next")}
          </Link>
        </div>
      </div>
    </div>
  );
}
