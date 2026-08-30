"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className="sr-only">{t("label")}</span>
      <select
        aria-label={t("label")}
        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        defaultValue={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {t(l as "pt-BR" | "en" | "es")}
          </option>
        ))}
      </select>
    </label>
  );
}
