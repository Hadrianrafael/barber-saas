"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction, type ActionState } from "../actions";
import { SubmitButton, FieldError, FormError, FormSuccess } from "./form-bits";

const initial: ActionState = { ok: false };

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action] = useActionState(resetPasswordAction, initial);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormSuccess>{t("resetDone")}</FormSuccess>
        <Link href={`/${locale}/sign-in`} className="block text-center text-sm underline">
          {t("signInLink")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.code && <FormError t={t} code={state.code} />}
      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
        <FieldError t={t} code={state.fieldErrors?.password} />
      </div>
      <div>
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <FieldError t={t} code={state.fieldErrors?.confirmPassword} />
      </div>
      <SubmitButton>{t("resetCta")}</SubmitButton>
    </form>
  );
}
