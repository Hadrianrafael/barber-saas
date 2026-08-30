"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { uploadImportAction, confirmImportAction, type ImportState } from "../actions";

const initial: ImportState = { ok: false };

type PreviewRow = {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: "ok" | "duplicate" | "error";
  errors: string[];
};

export function ImportWizard({
  preview,
}: {
  preview: null | {
    id: string;
    status: string;
    counts: { total: number; valid: number; duplicate: number; error: number };
    rows: PreviewRow[];
  };
}) {
  const t = useTranslations("importContacts");
  const locale = useLocale();
  const [upState, upForm, uploading] = useActionState(uploadImportAction, initial);
  const [confState, confForm, confirming] = useActionState(confirmImportAction, initial);

  return (
    <div className="space-y-6">
      {/* upload */}
      <form action={upForm} className="space-y-3 rounded-lg border p-4">
        <input type="hidden" name="locale" value={locale} />
        <p className="text-sm font-medium">{t("uploadTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("uploadHint")}</p>
        <input type="file" name="file" accept=".csv,text/csv" required className="block text-sm" />
        <Button type="submit" size="sm" disabled={uploading}>
          {t("upload")}
        </Button>
        {upState.code && !upState.ok && (
          <Alert variant="destructive" className="text-xs">
            {t.has(`err.${upState.code}`) ? t(`err.${upState.code}`) : t("err.generic")}
          </Alert>
        )}
      </form>

      {/* preview + confirm */}
      {preview && preview.status === "previewed" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge label={t("total")} value={preview.counts.total} />
            <Badge label={t("valid")} value={preview.counts.valid} tone="ok" />
            <Badge label={t("duplicates")} value={preview.counts.duplicate} tone="warn" />
            <Badge label={t("errors")} value={preview.counts.error} tone="err" />
          </div>

          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 text-left text-xs">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">{t("name")}</th>
                  <th className="p-2">{t("contact")}</th>
                  <th className="p-2">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((r) => (
                  <tr key={r.line} className="border-t">
                    <td className="p-2 text-muted-foreground">{r.line}</td>
                    <td className="p-2">{r.name || "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {r.email ?? r.phone ?? "—"}
                    </td>
                    <td className="p-2 text-xs">
                      <span
                        className={
                          r.status === "ok"
                            ? "text-emerald-600"
                            : r.status === "duplicate"
                              ? "text-amber-600"
                              : "text-destructive"
                        }
                      >
                        {t(`rowStatus.${r.status}`)}
                        {r.errors.length > 0 &&
                          ` — ${r.errors.map((e) => (t.has(`rowErr.${e}`) ? t(`rowErr.${e}`) : e)).join(", ")}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 200 && (
              <p className="p-2 text-xs text-muted-foreground">
                {t("truncatedPreview", { n: String(preview.rows.length) })}
              </p>
            )}
          </div>

          {confState.ok && confState.result ? (
            <Alert variant="success" className="text-sm">
              {t("imported", {
                n: String(confState.result.imported),
                skipped: String(confState.result.skipped),
              })}
            </Alert>
          ) : (
            <form action={confForm} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={preview.id} />
              <input type="hidden" name="locale" value={locale} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="includeDuplicates" value="true" />
                {t("alsoImportDuplicates")}
              </label>
              <Button type="submit" disabled={confirming || preview.counts.valid === 0}>
                {t("confirmImport", { n: String(preview.counts.valid) })}
              </Button>
              <span className="text-xs text-muted-foreground">{t("noOptInNote")}</span>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "err";
}) {
  const c =
    tone === "ok"
      ? "border-emerald-300 text-emerald-700"
      : tone === "warn"
        ? "border-amber-300 text-amber-700"
        : tone === "err"
          ? "border-destructive/40 text-destructive"
          : "";
  return (
    <span className={`rounded-full border px-3 py-1 ${c}`}>
      {label}: <strong>{value}</strong>
    </span>
  );
}
