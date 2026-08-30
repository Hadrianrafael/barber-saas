"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";

export function MessagesFilter({
  channel,
  status,
  counts,
}: {
  channel: string;
  status: string;
  counts: Record<string, number>;
}) {
  const t = useTranslations("messagesLog");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function set(key: string, value: string) {
    const p = new URLSearchParams(search.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-44" value={channel} onChange={(e) => set("channel", e.target.value)}>
        <option value="">{t("allChannels")}</option>
        {["EMAIL", "WHATSAPP", "SMS", "IN_APP"].map((c) => (
          <option key={c} value={c}>
            {t(`ch.${c}`)}
          </option>
        ))}
      </Select>
      <Select className="w-44" value={status} onChange={(e) => set("status", e.target.value)}>
        <option value="">{t("allStatuses")}</option>
        {["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "BOUNCED"].map((s) => (
          <option key={s} value={s}>
            {t(`st.${s}`)}
            {counts[s] ? ` (${counts[s]})` : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}
