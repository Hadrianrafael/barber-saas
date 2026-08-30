"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { isSchedulingError } from "@/features/scheduling/errors";
import {
  getBookingContext,
  getPublicSlots,
  createPublicBooking,
  cancelPublicBooking,
  reschedulePublicBooking,
} from "./service";
import { publicSlotsSchema, bookingSubmitSchema, manageBookingSchema } from "./schema";

export interface BookingState {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: {
    slots?: { startsAt: string; endsAt: string; employeeId: string }[];
    token?: string;
    checkoutUrl?: string;
  };
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Availability for one service+date (optionally one barber). Rate-limited per IP. */
export async function publicSlotsAction(slug: string, input: unknown): Promise<BookingState> {
  const rl = await rateLimit(`book:slots:${await clientIp()}`, 60, 60);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const parsed = publicSlotsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const ctx = await getBookingContext(slug);
  if (!ctx) return { ok: false, code: "notFound" };
  if (!ctx.onlineBookingEnabled) return { ok: false, code: "disabled" };

  try {
    const result = await getPublicSlots({
      tenantId: ctx.tenant.id,
      serviceId: parsed.data.serviceId,
      dateISO: parsed.data.dateISO,
      employeeId: parsed.data.employeeId,
    });
    // Flatten to a de-duplicated slot list, each carrying one bookable barber.
    const seen = new Map<string, { startsAt: string; endsAt: string; employeeId: string }>();
    for (const emp of result.byEmployee) {
      for (const s of emp.slots) {
        if (!seen.has(s.startsAt)) {
          seen.set(s.startsAt, {
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            employeeId: emp.employeeId,
          });
        }
      }
    }
    const slots = [...seen.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { ok: true, data: { slots } };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

export async function submitBookingAction(
  slug: string,
  _prev: BookingState,
  fd: FormData,
): Promise<BookingState> {
  const rl = await rateLimit(`book:submit:${await clientIp()}`, 10, 300);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const parsed = bookingSubmitSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]),
      ),
    };
  }
  if (!parsed.data.email && !parsed.data.phone) {
    return { ok: false, fieldErrors: { email: "contactRequired" } };
  }

  const ctx = await getBookingContext(slug);
  if (!ctx) return { ok: false, code: "notFound" };

  try {
    const res = await createPublicBooking(ctx, parsed.data);
    return { ok: true, code: "booked", data: { token: res.token, checkoutUrl: res.checkoutUrl } };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

export async function manageBookingAction(
  _prev: BookingState,
  fd: FormData,
): Promise<BookingState> {
  const rl = await rateLimit(`book:manage:${await clientIp()}`, 20, 300);
  if (!rl.ok) return { ok: false, code: "rateLimited" };

  const parsed = manageBookingSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, code: "invalid" };
  const d = parsed.data;

  try {
    if (d.action === "cancel") {
      await cancelPublicBooking(d.token);
      return { ok: true, code: "cancelled" };
    }
    if (!d.startsAt) return { ok: false, code: "invalid" };
    await reschedulePublicBooking(d.token, new Date(d.startsAt), d.employeeId);
    return { ok: true, code: "rescheduled" };
  } catch (e) {
    if (isSchedulingError(e)) return { ok: false, code: e.code };
    throw e;
  }
}
