import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSession, resolveActiveTenant } from "@/server/auth/current-user";
import { roleCan } from "@/server/rbac/permissions";
import { env } from "@/env";
import { getTenantById, getBusinessHours, listHolidays } from "@/features/tenant/service";
import { parseBookingConfig } from "@/features/tenant/booking-config";
import { parseChatbotConfig } from "@/features/chatbot/config";
import { parseLoyaltyConfig } from "@/features/loyalty/config";
import { SettingsTabs } from "@/features/tenant/components/settings-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getAppSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const active = resolveActiveTenant(session);
  if (!active) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("settings");
  const canEdit = roleCan(active.role, "tenant.settings.write");

  const [tenant, hours, holidays] = await Promise.all([
    getTenantById(active.tenantId),
    getBusinessHours(active.tenantId),
    listHolidays(active.tenantId),
  ]);
  if (!tenant) redirect(`/${locale}/onboarding`);

  const publicUrl = `${env.APP_URL}/barber/${tenant.slug}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("publicUrl")}</CardTitle>
        </CardHeader>
        <CardContent>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="text-sm underline">
            {publicUrl}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">{t("publicUrlHint")}</p>
        </CardContent>
      </Card>

      {!canEdit && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">{t("readOnly")}</CardContent>
        </Card>
      )}

      <fieldset disabled={!canEdit} className="disabled:opacity-60">
        <SettingsTabs
          tenant={{
            name: tenant.name,
            description: tenant.description,
            email: tenant.email,
            phone: tenant.phone,
            whatsapp: tenant.whatsapp,
            instagram: tenant.instagram,
            website: tenant.website,
            addressLine1: tenant.addressLine1,
            addressLine2: tenant.addressLine2,
            city: tenant.city,
            state: tenant.state,
            postalCode: tenant.postalCode,
            country: tenant.country,
            currency: tenant.currency,
            timezone: tenant.timezone,
            locale: tenant.locale,
            logoUrl: tenant.logoUrl,
            coverUrl: tenant.coverUrl,
          }}
          hours={hours.map((h) => ({
            weekday: h.weekday,
            startMin: h.startMin,
            endMin: h.endMin,
          }))}
          holidays={holidays.map((h) => ({
            id: h.id,
            date: h.date.toISOString().slice(0, 10),
            name: h.name,
            isClosed: h.isClosed,
          }))}
          bookingConfig={parseBookingConfig(tenant.bookingConfig)}
          chatbotConfig={parseChatbotConfig(tenant.chatbotConfig)}
          loyaltyConfig={parseLoyaltyConfig(tenant.loyaltyConfig)}
        />
      </fieldset>
    </div>
  );
}
