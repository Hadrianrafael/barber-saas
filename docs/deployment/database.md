# Database

PostgreSQL 16 + Prisma. One shared schema, `tenantId` on every tenant-scoped
table (ADR 0001). Migrations in `prisma/migrations/`, applied with
`prisma migrate deploy` (forward-only in every environment).

## Conventions

- **Money**: integer cents + a `currency` column. Service price/duration/buffer
  are **snapshotted onto `Appointment`** at booking; `Payment` snapshots
  amount/fee/net. Later catalogue edits never rewrite history.
- **Time**: `Appointment.startsAt/endsAt` are `timestamptz`; rendered in the
  tenant timezone.
- **Soft delete / history**: `Customer.anonymizedAt` (GDPR erase keeps
  appointment history), `status` enums for employees/services/customers.
  Removing a barber or service **deactivates** it — rows referencing it stay.
  `Service` FK on `Appointment` is `onDelete: Restrict`.
- **Idempotency**: `WebhookEvent @@unique([provider, eventId])`,
  `Message @@unique([provider, providerMessageId])`,
  `LoyaltyTransaction @@unique([appointmentId, reason])`,
  `Review @@unique(appointmentId)`.
- **Config as data**: `Plan.limits` / `Plan.priceCents*`,
  `Tenant.bookingConfig` / `chatbotConfig` / `loyaltyConfig` (JSON, validated in
  the app layer).

## Key indexes

`@@index([tenantId, …])` on every list surface (`startsAt`, `status`,
`createdAt`, `lastVisitAt`), `@@index([employeeId, startsAt])` and
`@@index([customerId, startsAt])` on `Appointment`, `@@index([status,
nextAttemptAt])` on `Message` (retry sweep), plus the
`btree_gist` **exclusion constraint** `appointment_no_overlap` that makes
double-booking impossible at the DB level.

## Review before launch

- [x] FKs + cascade/restrict rules deliberate (see above)
- [x] Unique constraints for idempotency + natural keys
      (`Customer` tenant+email / tenant+phone, `Coupon` tenant+code, …)
- [x] Tenant isolation column on every tenant table + `forTenant()` extension
- [x] Timestamps (`createdAt`/`updatedAt`) everywhere; `timestamptz` for
      scheduling
- [x] Currency + financial snapshots (no recompute from live catalogue)
- [x] Indexes cover the hot query paths; pagination on every list
- [ ] Loyalty point **expiry** enforcement (config field exists; sweep job is a
      follow-up)
- [ ] Scheduled-campaign pickup (`Campaign.scheduledAt` exists; cron is a
      follow-up)

## Backups

Azure Database for PostgreSQL Flexible Server: automated backups (7–35 day
retention, geo-redundant in prod). Point-in-time restore covers accidental data
loss. No destructive migration is ever auto-run.
