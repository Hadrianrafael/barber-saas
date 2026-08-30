import type { MemberRole } from "@prisma/client";

/**
 * Role-based access control.
 *
 * Roles are a fixed enum (OWNER > MANAGER > BARBER) plus the out-of-band
 * PLATFORM_ADMIN realm. Permissions are declared here as data, never as
 * scattered string checks. Every server action / route handler calls `can()`
 * (see guard.ts) — authorization is always decided on the server.
 *
 * Custom per-tenant roles are intentionally out of scope for V1
 * (docs/adr/0001). Adding them later means turning this map into a table without
 * touching call sites.
 */

export type Permission =
  | "tenant.settings.read"
  | "tenant.settings.write"
  | "tenant.billing.read"
  | "tenant.billing.manage"
  | "tenant.members.read"
  | "tenant.members.manage"
  | "employee.read"
  | "employee.write"
  | "service.read"
  | "service.write"
  | "customer.read"
  | "customer.write"
  | "customer.delete"
  | "appointment.read"
  | "appointment.write"
  | "appointment.manageAll" // act on any barber's agenda, not just your own
  | "finance.read"
  | "payment.link.create"
  | "payout.manage"
  | "campaign.read"
  | "campaign.write"
  | "conversation.read"
  | "conversation.handle"
  | "import.run"
  | "audit.read";

const OWNER_PERMS: Permission[] = [
  "tenant.settings.read",
  "tenant.settings.write",
  "tenant.billing.read",
  "tenant.billing.manage",
  "tenant.members.read",
  "tenant.members.manage",
  "employee.read",
  "employee.write",
  "service.read",
  "service.write",
  "customer.read",
  "customer.write",
  "customer.delete",
  "appointment.read",
  "appointment.write",
  "appointment.manageAll",
  "finance.read",
  "payment.link.create",
  "payout.manage",
  "campaign.read",
  "campaign.write",
  "conversation.read",
  "conversation.handle",
  "import.run",
  "audit.read",
];

const MANAGER_PERMS: Permission[] = [
  "tenant.settings.read",
  "tenant.billing.read",
  "tenant.members.read",
  "employee.read",
  "employee.write",
  "service.read",
  "service.write",
  "customer.read",
  "customer.write",
  "customer.delete",
  "appointment.read",
  "appointment.write",
  "appointment.manageAll",
  "finance.read",
  "payment.link.create",
  "campaign.read",
  "campaign.write",
  "conversation.read",
  "conversation.handle",
  "import.run",
];

const BARBER_PERMS: Permission[] = [
  "tenant.settings.read",
  "service.read",
  "employee.read",
  "customer.read",
  "customer.write",
  "appointment.read",
  "appointment.write", // own agenda only — enforced in the service layer
  "conversation.read",
];

export const ROLE_PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_PERMS),
  MANAGER: new Set(MANAGER_PERMS),
  BARBER: new Set(BARBER_PERMS),
};

export function roleCan(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
