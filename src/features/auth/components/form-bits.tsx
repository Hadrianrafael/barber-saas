"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Translator = ((key: string, values?: Record<string, string>) => string) & {
  has: (key: string) => boolean;
};

/** Map an action/zod code to a localized string under the `auth` namespace. */
export function msg(t: Translator, code: string, values?: Record<string, string>): string {
  if (t.has(`errors.${code}`)) return t(`errors.${code}`, values);
  if (t.has(code)) return t(code, values);
  return t("errors.invalidCredentials");
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {children}
    </Button>
  );
}

export function FieldError({ t, code }: { t: Translator; code?: string }) {
  if (!code) return null;
  return <p className="mt-1 text-xs text-destructive">{msg(t, code)}</p>;
}

export function FormError({ t, code }: { t: Translator; code?: string }) {
  if (!code) return null;
  return (
    <Alert variant="destructive" className="text-sm">
      {msg(t, code)}
    </Alert>
  );
}

export function FormSuccess({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <Alert variant="success" className="text-sm">
      {children}
    </Alert>
  );
}
