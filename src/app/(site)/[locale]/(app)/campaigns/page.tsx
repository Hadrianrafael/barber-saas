import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listCampaigns } from "@/features/campaigns/service";
import { launchCampaignAction, cancelCampaignAction } from "@/features/campaigns/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "campaign.read")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("campaigns");
  const canWrite = roleCan(active.role, "campaign.write");
  const rows = await listCampaigns(active.tenantId);
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/${locale}/campaigns/new`}>{t("new")}</Link>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`ch.${c.channel}`)} · {t(`status.${c.status}`)} ·{" "}
                      {c.status === "RUNNING" || c.status === "COMPLETED"
                        ? `${c.sentCount}/${c.totalRecipients}`
                        : ""}{" "}
                      · {df.format(c.createdAt)}
                    </p>
                  </div>
                  {canWrite && (c.status === "DRAFT" || c.status === "SCHEDULED") && (
                    <div className="flex gap-2">
                      <form action={launchCampaignActionBound}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <Button type="submit" size="sm">
                          {t("launch")}
                        </Button>
                      </form>
                      <form action={cancelCampaignAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <Button type="submit" size="sm" variant="ghost">
                          {t("cancel")}
                        </Button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// launchCampaignAction is a useActionState-style action; wrap for a plain form.
async function launchCampaignActionBound(fd: FormData) {
  "use server";
  await launchCampaignAction({ ok: false }, fd);
}
