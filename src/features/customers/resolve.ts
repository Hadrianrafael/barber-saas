import "server-only";
import type { AppointmentSource } from "@prisma/client";
import { prisma } from "@/server/db/client";

export class CustomerBlockedError extends Error {
  constructor() {
    super("customer is blocked");
    this.name = "CustomerBlockedError";
  }
}

/**
 * Find an existing customer for this tenant by email/phone (the schema enforces
 * both unique per tenant), otherwise create one. Shared by the public booking
 * flow and the chatbot. Never changes consent.
 */
export async function resolveOrCreateCustomer(
  tenantId: string,
  input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    locale: string;
    source?: AppointmentSource;
  },
): Promise<string> {
  const email = input.email || null;
  const phone = input.phone || null;

  if (email || phone) {
    const existing = await prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: { id: true, status: true },
    });
    if (existing) {
      if (existing.status === "BLOCKED") throw new CustomerBlockedError();
      return existing.id;
    }
  }

  const created = await prisma.customer.create({
    data: {
      tenantId,
      name: input.name,
      email,
      phone,
      whatsapp: phone,
      locale: input.locale,
      source: input.source ?? "PUBLIC_PAGE",
    },
    select: { id: true },
  });
  return created.id;
}
