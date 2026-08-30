import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAppSession } from "@/server/auth/current-user";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

// Authenticated area — always server-rendered per request.
export const dynamic = "force-dynamic";

const NAV = [
  { key: "dashboard", href: "dashboard" },
  { key: "agenda", href: "agenda" },
  { key: "clients", href: "clients" },
  { key: "team", href: "team" },
  { key: "services", href: "services" },
  { key: "finance", href: "finance" },
  { key: "campaigns", href: "campaigns" },
  { key: "conversations", href: "conversations" },
  { key: "messages", href: "messages" },
  { key: "payments", href: "payments" },
  { key: "billing", href: "billing" },
  { key: "settings", href: "settings" },
] as const;

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAppSession(locale);
  const t = await getTranslations("nav");

  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="flex flex-col border-r bg-muted/30 p-4">
        <div className="mb-6 px-2 text-sm font-semibold">Barber SaaS</div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={`/${locale}/${item.href}`}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 border-t pt-3">
          <div className="truncate px-2 text-xs text-muted-foreground">{session.email}</div>
          <LanguageSwitcher />
          <SignOutButton locale={locale} label={t("logout")} />
        </div>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
