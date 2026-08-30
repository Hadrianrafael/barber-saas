"use client";

import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { searchCustomersAction } from "@/features/agenda/actions";
import {
  createRewardAction,
  toggleRewardAction,
  redeemRewardAction,
  adjustPointsAction,
  type LoyaltyState,
} from "../actions";

const initial: LoyaltyState = { ok: false };

type Reward = {
  id: string;
  name: string;
  pointsCost: number;
  kind: string;
  isActive: boolean;
  percentOff: number | null;
  amountOffCents: number | null;
};

export function LoyaltyManager({
  rewards,
  services,
}: {
  rewards: Reward[];
  services: { id: string; name: string }[];
}) {
  const t = useTranslations("loyalty");
  const locale = useLocale();
  const [createState, createForm] = useActionState(createRewardAction, initial);
  const [kind, setKind] = useState("discount");

  return (
    <div className="space-y-8">
      {/* rewards */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("rewards")}</h2>
        {rewards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRewards")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rewards.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.pointsCost} {t("points")} · {t(`kind.${r.kind}`)}
                    {r.percentOff ? ` · ${r.percentOff}%` : ""}
                    {r.amountOffCents ? ` · ${(r.amountOffCents / 100).toFixed(2)}` : ""}
                  </p>
                </div>
                <form action={toggleRewardAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="isActive" value={(!r.isActive).toString()} />
                  <input type="hidden" name="locale" value={locale} />
                  <Button type="submit" size="sm" variant={r.isActive ? "outline" : "default"}>
                    {r.isActive ? t("disable") : t("enable")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={createForm} className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">{t("newReward")}</p>
          <input type="hidden" name="locale" value={locale} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="lr-name">{t("name")}</Label>
              <Input id="lr-name" name="name" required minLength={2} maxLength={80} />
            </div>
            <div>
              <Label htmlFor="lr-cost">{t("pointsCost")}</Label>
              <Input id="lr-cost" name="pointsCost" type="number" min={1} required />
            </div>
            <div>
              <Label htmlFor="lr-kind">{t("type")}</Label>
              <Select
                id="lr-kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="discount">{t("kind.discount")}</option>
                <option value="free_service">{t("kind.free_service")}</option>
                <option value="custom">{t("kind.custom")}</option>
              </Select>
            </div>
            {kind === "discount" && (
              <>
                <div>
                  <Label htmlFor="lr-pct">{t("percentOff")}</Label>
                  <Input id="lr-pct" name="percentOff" type="number" min={0} max={100} />
                </div>
                <div>
                  <Label htmlFor="lr-amt">{t("amountOff")}</Label>
                  <Input id="lr-amt" name="amountOff" type="number" min={0} step="0.01" />
                </div>
              </>
            )}
            {kind === "free_service" && (
              <div>
                <Label htmlFor="lr-svc">{t("service")}</Label>
                <Select id="lr-svc" name="serviceId">
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="lr-desc">{t("description")}</Label>
            <Input id="lr-desc" name="description" maxLength={200} />
          </div>
          {createState.code === "created" && (
            <Alert variant="success" className="text-xs">
              {t("rewardCreated")}
            </Alert>
          )}
          <Button type="submit" size="sm">
            {t("addReward")}
          </Button>
        </form>
      </section>

      {/* per-customer points */}
      <CustomerPoints rewards={rewards.filter((r) => r.isActive)} />
    </div>
  );
}

function CustomerPoints({ rewards }: { rewards: Reward[] }) {
  const t = useTranslations("loyalty");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [pending, startT] = useTransition();
  const [redeemState, redeemForm] = useActionState(redeemRewardAction, initial);
  const [adjustState, adjustForm] = useActionState(adjustPointsAction, initial);

  function search(term: string) {
    setQ(term);
    if (term.trim().length < 2) return setRows([]);
    startT(async () => {
      const res = await searchCustomersAction(term);
      setRows(((res.data?.rows as { id: string; name: string }[]) ?? []).slice(0, 6));
    });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("customerPoints")}</h2>
      <Input value={q} onChange={(e) => search(e.target.value)} placeholder={t("searchCustomer")} />
      {pending && <p className="text-xs text-muted-foreground">…</p>}
      {rows.length > 0 && !picked && (
        <ul className="rounded-lg border text-sm">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(c);
                  setRows([]);
                }}
                className="w-full px-3 py-2 text-left hover:bg-accent"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{picked.name}</p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)}>
              {t("change")}
            </Button>
          </div>

          <form action={adjustForm} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="customerId" value={picked.id} />
            <input type="hidden" name="locale" value={locale} />
            <div>
              <Label htmlFor="lp-delta">{t("adjustPoints")}</Label>
              <Input
                id="lp-delta"
                name="delta"
                type="number"
                className="w-28"
                placeholder="+50 / -20"
              />
            </div>
            <Input name="note" placeholder={t("reason")} className="flex-1" maxLength={200} />
            <Button type="submit" size="sm">
              {t("apply")}
            </Button>
          </form>
          {adjustState.code === "adjusted" && (
            <Alert variant="success" className="text-xs">
              {t("done")}
            </Alert>
          )}
          {adjustState.code === "INSUFFICIENT_POINTS" && (
            <Alert variant="destructive" className="text-xs">
              {t("err.INSUFFICIENT_POINTS")}
            </Alert>
          )}

          {rewards.length > 0 && (
            <form action={redeemForm} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="customerId" value={picked.id} />
              <input type="hidden" name="locale" value={locale} />
              <div>
                <Label htmlFor="lp-reward">{t("redeem")}</Label>
                <Select id="lp-reward" name="rewardId">
                  {rewards.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.pointsCost})
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm">
                {t("redeemBtn")}
              </Button>
            </form>
          )}
          {redeemState.code === "redeemed" && (
            <Alert variant="success" className="text-xs">
              {t("coupon")}: <strong>{redeemState.data?.couponCode}</strong>
            </Alert>
          )}
          {redeemState.code === "INSUFFICIENT_POINTS" && (
            <Alert variant="destructive" className="text-xs">
              {t("err.INSUFFICIENT_POINTS")}
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}
