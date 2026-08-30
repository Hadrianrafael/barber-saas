import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicTenant } from "@/features/public/tenant-public";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";

export const dynamic = "force-dynamic";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getPublicTenant(slug);
  if (!tenant) return { title: "Barbearia" };
  return {
    title: tenant.name,
    description: tenant.description ?? undefined,
    openGraph: {
      title: tenant.name,
      description: tenant.description ?? undefined,
      images: tenant.coverUrl ? [tenant.coverUrl] : undefined,
    },
  };
}

function fmtTime(min: number, locale: string) {
  // startMin/endMin are wall-clock minutes-of-day (timezone-agnostic).
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(min / 60), min % 60));
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

export default async function BarberPublicPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();

  const t = await getTranslations("publicPage");
  const address = [
    tenant.addressLine1,
    tenant.addressLine2,
    [tenant.city, tenant.state].filter(Boolean).join(", "),
    tenant.postalCode,
  ]
    .filter(Boolean)
    .join(" · ");

  const hoursByDay = new Map(tenant.businessHours.map((h) => [h.weekday, h]));

  return (
    <div className="min-h-screen bg-muted/20">
      {tenant.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.coverUrl} alt="" className="h-48 w-full object-cover sm:h-64" />
      )}

      <div className="container -mt-12 max-w-3xl space-y-6 pb-16">
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-4">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logoUrl}
                alt={tenant.name}
                className="h-24 w-24 rounded-xl border bg-background object-contain p-1 shadow"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-xl border bg-background text-2xl font-bold shadow">
                {tenant.name.charAt(0)}
              </div>
            )}
            <div className="pb-1">
              <h1 className="text-2xl font-bold">{tenant.name}</h1>
              {tenant.ratingAvg !== null && (
                <p className="text-sm text-muted-foreground">
                  ★ {tenant.ratingAvg.toFixed(1)} · {tenant.ratingCount}
                </p>
              )}
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        {tenant.description && (
          <p className="text-sm text-muted-foreground">{tenant.description}</p>
        )}

        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {address && <span>{address}</span>}
          {tenant.phone && <span>· {tenant.phone}</span>}
          {tenant.instagram && <span>· @{tenant.instagram}</span>}
        </div>

        <div>
          <Button size="lg" disabled>
            {t("bookCta")}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{t("bookSoon")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("services")}</CardTitle>
          </CardHeader>
          <CardContent>
            {tenant.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noServices")}</p>
            ) : (
              <ul className="divide-y">
                {tenant.services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      {s.description && (
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t("minutes", { n: String(s.durationMin) })}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {formatMoney(s.priceCents, s.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("team")}</CardTitle>
          </CardHeader>
          <CardContent>
            {tenant.employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noTeam")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {tenant.employees.map((e) => (
                  <li key={e.id} className="rounded-lg border p-3 text-center">
                    {e.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.photoUrl}
                        alt={e.name}
                        className="mx-auto h-16 w-16 rounded-full object-cover"
                      />
                    ) : (
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold">
                        {e.name.charAt(0)}
                      </div>
                    )}
                    <p className="mt-2 text-sm font-medium">{e.name}</p>
                    {e.specialties.length > 0 && (
                      <p className="text-xs text-muted-foreground">{e.specialties.join(", ")}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("hours")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                const h = hoursByDay.get(wd);
                return (
                  <li key={wd} className="flex justify-between">
                    <span>{t(`weekday.${WEEKDAY_KEYS[wd]}`)}</span>
                    <span className="text-muted-foreground">
                      {h
                        ? `${fmtTime(h.startMin, locale)} – ${fmtTime(h.endMin, locale)}`
                        : t("closed")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {tenant.ratingCount > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("reviews")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {tenant.reviews
                  .filter((r) => r.comment)
                  .map((r) => (
                    <li key={r.id} className="text-sm">
                      <span className="text-amber-500">
                        {"★".repeat(r.rating)}
                        {"☆".repeat(5 - r.rating)}
                      </span>
                      <p className="text-muted-foreground">{r.comment}</p>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
