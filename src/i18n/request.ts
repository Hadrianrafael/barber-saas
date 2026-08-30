import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

function isSupported(value: string | undefined): value is (typeof routing.locales)[number] {
  return !!value && (routing.locales as readonly string[]).includes(value);
}

/**
 * Loads the message catalogue for the active request locale.
 * Messages live in /messages/<locale>.json and are split by namespace at the top
 * level (common, auth, dashboard, agenda, ...). Components never hard-code copy.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isSupported(requested) ? requested : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    now: new Date(),
  };
});
