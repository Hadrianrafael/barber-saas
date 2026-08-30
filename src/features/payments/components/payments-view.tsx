"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/features/auth/components/form-bits";
import { formatMoney } from "@/lib/utils";
import {
  startConnectAction,
  refreshConnectAction,
  createPaymentLinkAction,
  cancelPaymentLinkAction,
  refundPaymentAction,
  type PaymentsState,
} from "../actions";

const initial: PaymentsState = { ok: false };

interface Account {
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  connected: boolean;
}
interface Link {
  id: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  url: string | null;
  customerName: string | null;
  createdAt: string;
}
interface Pay {
  id: string;
  amountCents: number;
  refundedCents: number;
  platformFeeCents: number;
  netCents: number | null;
  currency: string;
  status: string;
  method: string;
  customerName: string | null;
  serviceName: string | null;
  createdAt: string;
}

export function PaymentsView({
  locale,
  currency,
  stripeConnectConfigured,
  canManageAccount,
  canCreateLink,
  account,
  links,
  payments,
}: {
  locale: string;
  currency: string;
  stripeConnectConfigured: boolean;
  canManageAccount: boolean;
  canCreateLink: boolean;
  account: Account;
  links: Link[];
  payments: Pay[];
}) {
  const t = useTranslations("payments");
  const [showNew, setShowNew] = useState(false);
  const ready = account.chargesEnabled;

  return (
    <div className="space-y-6">
      {!stripeConnectConfigured && <Alert className="text-sm">{t("notConfigured")}</Alert>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("connectTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("accountStatus")}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {t.has(`st.${account.status}`) ? t(`st.${account.status}`) : account.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("chargesEnabled")}</span>
            <span>{account.chargesEnabled ? t("yes") : t("no")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("payoutsEnabled")}</span>
            <span>{account.payoutsEnabled ? t("yes") : t("no")}</span>
          </div>
          {canManageAccount && (
            <div className="flex flex-wrap gap-2 pt-3">
              <form action={startConnectAction}>
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" size="sm" disabled={!stripeConnectConfigured}>
                  {account.connected ? t("continueOnboarding") : t("connect")}
                </Button>
              </form>
              {account.connected && (
                <form action={refreshConnectAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("refreshStatus")}
                  </Button>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">{t("links")}</CardTitle>
          {canCreateLink && (
            <Button size="sm" onClick={() => setShowNew(true)} disabled={!ready}>
              {t("createLink")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!ready && <p className="mb-2 text-xs text-muted-foreground">{t("needAccount")}</p>}
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noLinks")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {l.description} · {formatMoney(l.amountCents, l.currency, locale)}
                    {l.customerName ? ` · ${l.customerName}` : ""}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {t.has(`lst.${l.status}`) ? t(`lst.${l.status}`) : l.status}
                    {l.url && l.status === "ACTIVE" && (
                      <a href={l.url} target="_blank" rel="noreferrer" className="underline">
                        {t("open")}
                      </a>
                    )}
                    {canCreateLink && l.status === "ACTIVE" && (
                      <form action={cancelPaymentLinkAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="underline">
                          {t("cancel")}
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("received")}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {payments.map((p) => (
                <PaymentRow key={p.id} p={p} locale={locale} canRefund={canManageAccount} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showNew && (
        <NewLinkModal locale={locale} currency={currency} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

function PaymentRow({ p, locale, canRefund }: { p: Pay; locale: string; canRefund: boolean }) {
  const t = useTranslations("payments");
  const [state, action] = useActionState(refundPaymentAction, initial);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  const refundable =
    (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED") &&
    p.refundedCents < p.amountCents;

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span>
          {new Date(p.createdAt).toLocaleDateString(locale)} ·{" "}
          {formatMoney(p.amountCents, p.currency, locale)}
          {p.customerName ? ` · ${p.customerName}` : ""}
          {p.serviceName ? ` · ${p.serviceName}` : ""}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {t.has(`pst.${p.status}`) ? t(`pst.${p.status}`) : p.status}
          {canRefund && refundable && (
            <button className="underline" onClick={() => setOpen((v) => !v)}>
              {t("refund")}
            </button>
          )}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {t("fee")}: {formatMoney(p.platformFeeCents, p.currency, locale)} · {t("net")}:{" "}
        {formatMoney(p.netCents ?? p.amountCents - p.platformFeeCents, p.currency, locale)}
        {p.refundedCents > 0 &&
          ` · ${t("refunded")}: ${formatMoney(p.refundedCents, p.currency, locale)}`}
      </div>
      {open && (
        <form action={action} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="locale" value={locale} />
          <div>
            <Label className="text-xs">{t("refundAmount")}</Label>
            <Input
              name="amount"
              type="number"
              step="0.01"
              min={0}
              placeholder={((p.amountCents - p.refundedCents) / 100).toFixed(2)}
              className="w-28"
            />
          </div>
          <SubmitButton>{t("confirmRefund")}</SubmitButton>
          {state.code && !state.ok && (
            <span className="text-xs text-destructive">
              {t.has(`err.${state.code}`) ? t(`err.${state.code}`) : t("err.generic")}
            </span>
          )}
        </form>
      )}
    </li>
  );
}

function NewLinkModal({
  locale,
  currency,
  onClose,
}: {
  locale: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations("payments");
  const [state, action] = useActionState(createPaymentLinkAction, initial);

  return (
    <Modal open onClose={onClose} title={t("createLink")}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        {state.code && !state.ok && (
          <Alert variant="destructive" className="text-sm">
            {t.has(`err.${state.code}`) ? t(`err.${state.code}`) : t("err.generic")}
          </Alert>
        )}
        {state.ok && state.url && (
          <Alert variant="success" className="break-all text-sm">
            {t("linkReady")}:{" "}
            <a href={state.url} className="underline">
              {state.url}
            </a>
          </Alert>
        )}
        <div>
          <Label>{t("description")}</Label>
          <Input name="description" required minLength={2} maxLength={140} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("amount")}</Label>
            <Input name="amount" type="number" step="0.01" min={1} required />
          </div>
          <div>
            <Label>{t("currency")}</Label>
            <Input name="currency" defaultValue={currency} maxLength={3} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <SubmitButton>{t("generate")}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
