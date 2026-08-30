import "server-only";
import { prisma } from "@/server/db/client";
import { parseBookingConfig } from "@/features/tenant/booking-config";

/**
 * Read model for the public barbershop page `/barber/{slug}`.
 * Exposes only what a prospective client should see; never internal fields.
 * Suspended / canceled tenants return null (page 404s).
 */
export async function getPublicTenant(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      status: true,
      locale: true,
      timezone: true,
      currency: true,
      logoUrl: true,
      coverUrl: true,
      instagram: true,
      website: true,
      phone: true,
      whatsapp: true,
      email: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      bookingConfig: true,
      businessHours: {
        where: { employeeId: null },
        orderBy: { weekday: "asc" },
        select: { weekday: true, startMin: true, endMin: true },
      },
      services: {
        where: { status: "ACTIVE" },
        orderBy: { priceCents: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          currency: true,
          durationMin: true,
        },
      },
      employees: {
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, photoUrl: true, bio: true, specialties: true },
      },
      reviews: {
        where: { isPublished: true },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, rating: true, comment: true, createdAt: true },
      },
    },
  });

  if (!tenant) return null;
  if (tenant.status === "SUSPENDED" || tenant.status === "CANCELED") return null;

  const ratingCount = tenant.reviews.length;
  const ratingAvg =
    ratingCount > 0 ? tenant.reviews.reduce((s, r) => s + r.rating, 0) / ratingCount : null;

  return {
    ...tenant,
    bookingConfig: parseBookingConfig(tenant.bookingConfig),
    ratingAvg,
    ratingCount,
  };
}

export type PublicTenant = NonNullable<Awaited<ReturnType<typeof getPublicTenant>>>;
