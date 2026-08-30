import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-4xl font-bold">404</p>
      <p className="text-muted-foreground">{t("empty")}</p>
      <Link href="/" className="underline">
        {t("back")}
      </Link>
    </div>
  );
}
