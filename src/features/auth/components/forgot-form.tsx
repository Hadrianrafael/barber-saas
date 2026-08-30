"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type ActionState } from "../actions";
import { SubmitButton, FormSuccess } from "./form-bits";

const initial: ActionState = { ok: false };

export function ForgotForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action] = useActionState(requestPasswordResetAction, initial);

  if (state.ok) return <FormSuccess>{t("forgotDone")}</FormSuccess>;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <SubmitButton>{t("forgotCta")}</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        <Link href={`/${locale}/sign-in`} className="underline">
          {t("signInLink")}
        </Link>
      </p>
    </form>
  );
}
