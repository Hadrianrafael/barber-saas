"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction, type ActionState } from "../actions";
import { SubmitButton, FieldError, FormError, FormSuccess } from "./form-bits";

const initial: ActionState = { ok: false };

export function SignUpForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action] = useActionState(signUpAction, initial);

  if (state.ok && state.code === "verifyPending") {
    return (
      <FormSuccess>{t("verifyPending", { email: String(state.data?.email ?? "") })}</FormSuccess>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {state.code && !state.ok && <FormError t={t} code={state.code} />}

      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" required minLength={2} />
        <FieldError t={t} code={state.fieldErrors?.name} />
      </div>
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <FieldError t={t} code={state.fieldErrors?.email} />
      </div>
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

      <SubmitButton>{t("signUpCta")}</SubmitButton>

      <p className="text-center text-sm text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link href={`/${locale}/sign-in`} className="underline">
          {t("signInLink")}
        </Link>
      </p>
    </form>
  );
}
