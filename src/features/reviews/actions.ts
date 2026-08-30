"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requireTenantContext } from "@/server/rbac/guard";
import { submitReview, setReviewPublished, ReviewError } from "./service";

export interface ReviewState {
  ok: boolean;
  code?: string;
}

const submitSchema = z.object({
  token: z.string().min(10).max(200),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function submitReviewAction(_prev: ReviewState, fd: FormData): Promise<ReviewState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`review:submit:${ip}`, 10, 300)).ok)
    return { ok: false, code: "rateLimited" };

  const parsed = submitSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, code: "invalid" };
  try {
    await submitReview(parsed.data.token, parsed.data.rating, parsed.data.comment || null);
    return { ok: true, code: "thanks" };
  } catch (e) {
    if (e instanceof ReviewError) return { ok: false, code: e.code };
    throw e;
  }
}

export async function moderateReviewAction(fd: FormData): Promise<void> {
  const ctx = await requireTenantContext({ permission: "review.moderate" });
  const id = String(fd.get("id") ?? "");
  const publish = String(fd.get("publish") ?? "") === "true";
  if (id) await setReviewPublished(ctx.tenantId, id, publish);
  revalidatePath(`/${String(fd.get("locale") ?? "pt-BR")}/reviews`);
}
