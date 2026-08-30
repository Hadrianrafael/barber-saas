import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listConversations } from "@/features/chatbot/service";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const STATUSES = ["", "OPEN", "PENDING_HUMAN", "HUMAN_HANDLING", "RESOLVED", "CLOSED"] as const;

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { status = "", page = "1" } = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "conversation.read")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("conversations");
  const { rows, total, pageSize } = await listConversations(active.tenantId, {
    status: status || undefined,
    page: Number(page) || 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s || "all"}
            href={`/${locale}/conversations${s ? `?status=${s}` : ""}`}
            className={`rounded-full border px-3 py-1 ${
              status === s ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {s ? t(`status.${s}`) : t("all")}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/${locale}/conversations/${c.id}`}
                    className="flex items-center justify-between gap-3 p-3 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {c.customer?.name ?? t("anonymous")}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t(`channel.${c.channel}`)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`handled.${c.handledBy}`)} · {c._count.messages} {t("messages")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          c.status === "PENDING_HUMAN"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`status.${c.status}`)}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.lastMessageAt ? df.format(c.lastMessageAt) : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <Link
            aria-disabled={Number(page) <= 1}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/${locale}/conversations?status=${status}&page=${Number(page) - 1}`}
          >
            {t("prev")}
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            aria-disabled={Number(page) >= pages}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/${locale}/conversations?status=${status}&page=${Number(page) + 1}`}
          >
            {t("next")}
          </Link>
        </div>
      )}
    </div>
  );
}
