"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type ActionState } from "../actions";
import { SubmitButton, FieldError, FormError } from "./form-bits";

const initial: ActionState = { ok: false };

export function SignInForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action] = useActionState(signInAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />

      {state.code && !state.ok && state.code !== "emailNotVerified" && (
        <FormError t={t} code={state.code} />
      )}
      {state.code === "emailNotVerified" && (
        <p className="text-sm text-muted-foreground">
          {t("errors.emailNotVerified")}{" "}
          <Link className="underline" href={`/${locale}/verify-email`}>
            {t("verifyResend")}
          </Link>
        </p>
      )}

      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <FieldError t={t} code={state.fieldErrors?.email} />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t("password")}</Label>
          <Link
            href={`/${locale}/forgot-password`}
            className="text-xs text-muted-foreground underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FieldError t={t} code={state.fieldErrors?.password} />
      </div>

      <SubmitButton>{t("signInCta")}</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href={`/${locale}/sign-up`} className="underline">
          {t("signUpLink")}
        </Link>
      </p>
    </form>
  );
}
