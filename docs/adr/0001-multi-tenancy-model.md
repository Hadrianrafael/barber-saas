# ADR 0001 — Multi-tenancy model

**Status:** accepted · **Date:** 2026-08-29

## Context

Commercial SaaS, many barbershops, each may later run multiple units. Hard
requirement: a barbershop must never read another's data. Need a model that is
cheap to start and does not block growth.

## Decision

**Single shared PostgreSQL schema. Every tenant-owned table has a `tenantId`
column (FK to `Tenant`, indexed).**

Isolation is enforced in one place: `forTenant(tenantId)` in
`src/server/db/tenant.ts`, a Prisma client extension that injects the tenant
predicate into every read and write. Application code must use it for anything
tenant-scoped; the raw client is reserved for identity/platform tables and the
Super Admin realm.

Multiple units per company are modeled later as child `Tenant` rows linked to a
parent org (or an `Org` table), not as a new isolation mechanism.

Roles are a fixed enum (`OWNER`/`MANAGER`/`BARBER`) plus `PLATFORM_ADMIN`, with
the permission set declared as data in code. Custom per-tenant roles are out of
scope for V1.

## Alternatives considered

- **Schema-per-tenant / database-per-tenant** — stronger isolation, but heavy
  operationally (migrations × N, connection management, provisioning) for a
  price-sensitive SMB product. Revisit only for an enterprise tier.
- **RLS (Postgres row-level security)** — good defense in depth; the app-level
  extension is simpler to reason about and test now. RLS can be layered on later
  as belt-and-braces without changing call sites.
- **Roles as a table now** — more flexible, not yet needed (YAGNI). The
  permission map can become a table later without touching `can()` call sites.

## Consequences

- One migration path, low ops cost, fast to V1.
- The isolation guarantee rests on discipline + the extension + tests. Slice 12
  ships an automated cross-tenant test suite. A future RLS layer is the
  recommended hardening.
- `ServiceEmployee` (join table, no direct `tenantId`) is guarded explicitly in
  the service layer, not by the extension.
