import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { listReviews, ratingSummary } from "@/features/reviews/service";
import { moderateReviewAction } from "@/features/reviews/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-500">
      {"★".repeat(Math.round(n))}
      <span className="text-muted-foreground/40">{"★".repeat(5 - Math.round(n))}</span>
    </span>
  );
}

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { filter = "pending", page = "1" } = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "review.moderate")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("reviews");
  const published = filter === "published" ? true : filter === "pending" ? false : undefined;
  const [summary, { rows, total, pageSize }] = await Promise.all([
    ratingSummary(active.tenantId),
    listReviews(active.tenantId, { published, page: Number(page) || 1 }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "short" });
  const canModerate = roleCan(active.role, "review.moderate");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("overall")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.overall.avg.toFixed(1)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({summary.overall.count})
              </span>
            </div>
            <Stars n={summary.overall.avg} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("perBarber")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {summary.perBarber.length === 0 ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              summary.perBarber.map((b) => (
                <div key={b.employeeId} className="flex justify-between">
                  <span>{b.name}</span>
                  <span>
                    {b.avg.toFixed(1)}{" "}
                    <span className="text-xs text-muted-foreground">({b.count})</span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 text-sm">
        {["pending", "published", "all"].map((f) => (
          <Link
            key={f}
            href={`/${locale}/reviews?filter=${f}`}
            className={`rounded-full border px-3 py-1 ${filter === f ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {t(`filter.${f}`)}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Stars n={r.rating} />
                    <span className="text-xs text-muted-foreground">{df.format(r.createdAt)}</span>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                  <p className="text-xs text-muted-foreground">
                    {r.customer?.name ?? "—"} · {r.employee?.name ?? "—"} ·{" "}
                    {r.isPublished ? t("published") : t("pending")}
                  </p>
                  {canModerate && (
                    <form action={moderateReviewAction} className="pt-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="publish" value={(!r.isPublished).toString()} />
                      <input type="hidden" name="locale" value={locale} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={r.isPublished ? "outline" : "default"}
                      >
                        {r.isPublished ? t("hide") : t("approve")}
                      </Button>
                    </form>
                  )}
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
            href={`/${locale}/reviews?filter=${filter}&page=${Number(page) - 1}`}
          >
            {t("prev")}
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            aria-disabled={Number(page) >= pages}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/${locale}/reviews?filter=${filter}&page=${Number(page) + 1}`}
          >
            {t("next")}
          </Link>
        </div>
      )}
    </div>
  );
}
