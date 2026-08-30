import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/**
 * Tenant isolation layer.
 *
 * `forTenant(tenantId)` returns a Prisma client where every tenant-owned model is
 * automatically constrained to that tenant:
 *   - reads get `where.tenantId = tenantId` merged in
 *   - writes get `data.tenantId = tenantId` injected
 *
 * Application code MUST go through this for anything tenant-scoped. The raw
 * `prisma` client is reserved for identity/platform tables (User, Plan,
 * WebhookEvent, Session, ...) and for the Super Admin realm.
 *
 * A cross-tenant data leak is the most expensive bug a multi-tenant SaaS can
 * ship — see docs/adr/0001-multi-tenancy-model.md.
 */

const TENANT_SCOPED_MODELS = new Set<string>([
  "TenantMember",
  "ImpersonationGrant",
  "Employee",
  "Service",
  "ServiceEmployee", // scoped transitively; guarded by explicit checks in services
  "BusinessHour",
  "Holiday",
  "BlockedTime",
  "Customer",
  "Appointment",
  "Subscription",
  "PayoutAccount",
  "PaymentLink",
  "Payment",
  "Invoice",
  "MessageTemplate",
  "Campaign",
  "Message",
  "Conversation",
  "Notification",
  "Review",
  "LoyaltyAccount",
  "Coupon",
  "ContactImport",
  "TenantFeatureFlag",
]);

// Models above that do NOT have a direct `tenantId` column (scoped via relations).
const NO_DIRECT_TENANT_COLUMN = new Set<string>(["ServiceEmployee"]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

const WRITE_WITH_WHERE = new Set(["updateMany", "deleteMany", "update", "delete", "upsert"]);

export type TenantPrisma = ReturnType<typeof buildTenantClient>;

function buildTenantClient(tenantId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }
          if (NO_DIRECT_TENANT_COLUMN.has(model)) {
            // These are guarded explicitly in the service layer; pass through.
            return query(args);
          }

          const a = (args ?? {}) as Record<string, unknown>;

          if (READ_OPS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
            a.where = { ...(a.where as object), tenantId };
          }

          if (operation === "create") {
            a.data = { ...(a.data as object), tenantId };
          }

          if (operation === "createMany" || operation === "createManyAndReturn") {
            const data = a.data;
            a.data = Array.isArray(data)
              ? data.map((d) => ({ ...(d as object), tenantId }))
              : { ...(data as object), tenantId };
          }

          if (operation === "upsert") {
            a.create = { ...(a.create as object), tenantId };
          }

          return query(a);
        },
      },
    },
  });
}

const cache = new Map<string, TenantPrisma>();

export function forTenant(tenantId: string): TenantPrisma {
  if (!tenantId) throw new Error("forTenant() called without a tenantId");
  let client = cache.get(tenantId);
  if (!client) {
    client = buildTenantClient(tenantId);
    cache.set(tenantId, client);
  }
  return client;
}

/** Escape hatch for raw SQL that still needs manual tenant predicates. */
export { prisma as unsafePrisma };
export { Prisma };
