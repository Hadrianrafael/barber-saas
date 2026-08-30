"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/server/rbac/guard";
import { createReward, setRewardActive, redeemReward, adjustPoints, LoyaltyError } from "./service";

export interface LoyaltyState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: { couponCode?: string };
}

const rev = (locale: string) => revalidatePath(`/${locale}/loyalty`);
const actor = (ctx: Awaited<ReturnType<typeof requireTenantContext>>) => ({
  userId: ctx.session.userId,
  label: ctx.session.email,
});

const rewardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(200).optional().or(z.literal("")),
  pointsCost: z.coerce.number().int().min(1).max(1_000_000),
  kind: z.enum(["discount", "free_service", "custom"]),
  amountOff: z.coerce.number().min(0).max(100_000).optional(),
  percentOff: z.coerce.number().int().min(0).max(100).optional(),
  serviceId: z.string().optional().or(z.literal("")),
  locale: z.string().default("pt-BR"),
});

export async function createRewardAction(_p: LoyaltyState, fd: FormData): Promise<LoyaltyState> {
  const ctx = await requireTenantContext({ permission: "loyalty.manage" });
  const parsed = rewardSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
      ),
    };
  }
  const d = parsed.data;
  await createReward(ctx.tenantId, {
    name: d.name,
    description: d.description || null,
    pointsCost: d.pointsCost,
    kind: d.kind,
    amountOffCents: d.amountOff ? Math.round(d.amountOff * 100) : null,
    percentOff: d.percentOff || null,
    serviceId: d.serviceId || null,
  });
  rev(d.locale);
  return { ok: true, code: "created" };
}

export async function toggleRewardAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "loyalty.manage" });
  const id = String(fd.get("id") ?? "");
  const isActive = String(fd.get("isActive") ?? "") === "true";
  if (id) await setRewardActive(ctx.tenantId, id, isActive);
  rev(String(fd.get("locale") ?? "pt-BR"));
}

export async function redeemRewardAction(_p: LoyaltyState, fd: FormData): Promise<LoyaltyState> {
  const ctx = await requireTenantContext({ permission: "loyalty.manage" });
  const customerId = String(fd.get("customerId") ?? "");
  const rewardId = String(fd.get("rewardId") ?? "");
  if (!customerId || !rewardId) return { ok: false, code: "invalid" };
  try {
    const { couponCode } = await redeemReward(ctx.tenantId, customerId, rewardId, actor(ctx));
    rev(String(fd.get("locale") ?? "pt-BR"));
    return { ok: true, code: "redeemed", data: { couponCode } };
  } catch (e) {
    if (e instanceof LoyaltyError) return { ok: false, code: e.code };
    throw e;
  }
}

export async function adjustPointsAction(_p: LoyaltyState, fd: FormData): Promise<LoyaltyState> {
  const ctx = await requireTenantContext({ permission: "loyalty.manage" });
  const customerId = String(fd.get("customerId") ?? "");
  const delta = Number(fd.get("delta") ?? 0);
  const note = String(fd.get("note") ?? "");
  if (!customerId || !delta) return { ok: false, code: "invalid" };
  try {
    await adjustPoints(ctx.tenantId, customerId, delta, note, actor(ctx));
    rev(String(fd.get("locale") ?? "pt-BR"));
    return { ok: true, code: "adjusted" };
  } catch (e) {
    if (e instanceof LoyaltyError) return { ok: false, code: e.code };
    throw e;
  }
}
