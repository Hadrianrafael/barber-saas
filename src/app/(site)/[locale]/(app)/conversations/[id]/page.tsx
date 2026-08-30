import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { getConversationForStaff } from "@/features/chatbot/service";
import { ConversationThread } from "@/features/chatbot/components/conversation-thread";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "conversation.read")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("conversations");
  const conv = await getConversationForStaff(active.tenantId, id);
  if (!conv) notFound();

  const canHandle = roleCan(active.role, "conversation.handle");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/${locale}/conversations`} className="text-sm text-muted-foreground underline">
        ← {t("backToList")}
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{conv.customer?.name ?? t("anonymous")}</h1>
          <p className="text-xs text-muted-foreground">
            {t(`channel.${conv.channel}`)} · {t(`status.${conv.status}`)} ·{" "}
            {t(`handled.${conv.handledBy}`)}
          </p>
        </div>
      </div>

      <ConversationThread
        conversationId={conv.id}
        locale={locale}
        status={conv.status}
        handledBy={conv.handledBy}
        canHandle={canHandle}
        messages={conv.messages}
      />
    </div>
  );
}
