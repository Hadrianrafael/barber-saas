"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ProfilePanel,
  RegionalPanel,
  HoursPanel,
  HolidaysPanel,
  BookingConfigPanel,
  ChatbotPanel,
  BrandingPanel,
  type TenantData,
} from "./settings-panels";
import type { ChatbotConfig } from "@/features/chatbot/config";

export function SettingsTabs({
  tenant,
  hours,
  holidays,
  bookingConfig,
  chatbotConfig,
}: {
  tenant: TenantData;
  hours: { weekday: number; startMin: number; endMin: number }[];
  holidays: { id: string; date: string; name: string; isClosed: boolean }[];
  bookingConfig: React.ComponentProps<typeof BookingConfigPanel>["config"];
  chatbotConfig: ChatbotConfig;
}) {
  const t = useTranslations("settings");
  return (
    <Tabs defaultValue="profile">
      <TabsList className="flex-wrap">
        <TabsTrigger value="profile">{t("tabProfile")}</TabsTrigger>
        <TabsTrigger value="branding">{t("tabBranding")}</TabsTrigger>
        <TabsTrigger value="regional">{t("tabRegional")}</TabsTrigger>
        <TabsTrigger value="hours">{t("tabHours")}</TabsTrigger>
        <TabsTrigger value="holidays">{t("tabHolidays")}</TabsTrigger>
        <TabsTrigger value="booking">{t("tabBooking")}</TabsTrigger>
        <TabsTrigger value="chatbot">{t("tabChatbot")}</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">
        <ProfilePanel tenant={tenant} />
      </TabsContent>
      <TabsContent value="branding">
        <BrandingPanel tenant={tenant} />
      </TabsContent>
      <TabsContent value="regional">
        <RegionalPanel tenant={tenant} />
      </TabsContent>
      <TabsContent value="hours">
        <HoursPanel rows={hours} />
      </TabsContent>
      <TabsContent value="holidays">
        <HolidaysPanel holidays={holidays} />
      </TabsContent>
      <TabsContent value="booking">
        <BookingConfigPanel config={bookingConfig} />
      </TabsContent>
      <TabsContent value="chatbot">
        <ChatbotPanel config={chatbotConfig} />
      </TabsContent>
    </Tabs>
  );
}
