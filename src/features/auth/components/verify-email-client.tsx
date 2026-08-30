"use client";

import { useActionState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyEmailAction, resendVerificationAction, type ActionState } from "../actions";
import { SubmitButton, FormError, FormSuccess } from "./form-bits";

const initial: ActionState = { ok: false };

function ResendForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, action] = useActionState(resendVerificationAction, initial);

  if (state.ok && state.data?.email) {
    return <FormSuccess>{t("verifyPending", { email: String(state.data.email) })}</FormSuccess>;
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {state.code === "rateLimited" && <FormError t={t} code="rateLimited" />}
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <SubmitButton>{t("verifyResend")}</SubmitButton>
    </form>
  );
}

/** With a token → auto-verify on mount. Without → show a resend form. */
export function VerifyEmailClient({ token }: { token?: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [state, run] = useActionState<ActionState, void>(
    async () => (token ? verifyEmailAction(token) : initial),
    initial,
  );

  useEffect(() => {
    if (token) run();
  }, [token, run]);

  if (!token) return <ResendForm />;

  if (state.ok) {
    return (
      <div className="space-y-4">
        <FormSuccess>{t("verifySuccess")}</FormSuccess>
        <Link href={`/${locale}/sign-in`} className="block text-center text-sm underline">
          {t("signInLink")}
        </Link>
      </div>
    );
  }
  if (state.code === "verifyInvalid") {
    return (
      <div className="space-y-4">
        <FormError t={t} code="verifyInvalid" />
        <ResendForm />
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{t("verifyTitle")}…</p>;
}
