"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { adminSignInAction, type AdminActionState } from "../actions";

const initial: AdminActionState = { ok: false };

export function AdminSignInForm() {
  const [state, action] = useActionState(adminSignInAction, initial);
  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <Alert variant="destructive" className="text-sm">
          {state.error}
        </Alert>
      )}
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <SubmitButton>Entrar</SubmitButton>
    </form>
  );
}
