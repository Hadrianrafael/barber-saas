import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { getImport, listImports } from "@/features/import/service";
import type { ImportReport } from "@/features/import/service";
import { ImportWizard } from "@/features/import/components/import-wizard";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);

  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);
  if (!roleCan(active.role, "import.run")) redirect(`/${locale}/dashboard`);

  const t = await getTranslations("importContacts");
  const [imports, current] = await Promise.all([
    listImports(active.tenantId),
    id ? getImport(active.tenantId, id) : Promise.resolve(null),
  ]);

  const preview = current
    ? {
        id: current.id,
        status: current.status,
        counts: (current.report as unknown as ImportReport).counts,
        rows: (current.report as unknown as ImportReport).rows,
      }
    : imports[0] && imports[0].status === "previewed"
      ? {
          id: imports[0].id,
          status: imports[0].status,
          counts: (imports[0].report as unknown as ImportReport).counts,
          rows: (imports[0].report as unknown as ImportReport).rows,
        }
      : null;

  const df = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ImportWizard preview={preview} />

      {imports.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("history")}</h2>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y text-sm">
                {imports.map((im) => (
                  <li key={im.id} className="flex items-center justify-between p-3">
                    <span className="truncate">{im.fileName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(`state.${im.status}`)} · {im.importedRows}/{im.totalRows} ·{" "}
                      {df.format(im.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
