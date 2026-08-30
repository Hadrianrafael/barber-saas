# ADR 0005 — Scheduling domain & double-booking prevention

**Status:** accepted · **Date:** 2026-08-31

## Context

Appointments will be created and changed from four surfaces: the dashboard now,
and later the public booking page, the chatbot, and inbound WhatsApp. The rules
(availability, buffers, working hours, time off, holidays, status lifecycle)
must be identical everywhere, and **two appointments must never overlap for the
same barber**, including under concurrent requests.

## Decision

### One reusable domain, no rules in the UI

`src/features/scheduling/` is the single source of truth:

| Function | Purpose |
|---|---|
| `getAvailableSlots({tenantId, serviceId, dateISO, employeeId?})` | bookable start times, per eligible barber |
| `createAppointment(...)` | validate + insert |
| `rescheduleAppointment(...)` | move (re-validates) |
| `confirm / start / complete / markNoShow / cancelAppointment` | status transitions |

Pure, DB-free helpers do the hard maths and are unit-tested directly:
`computeSlots()` (interval subtraction of breaks, blocks, busy appointments +
their buffers, then a grid walk) and `time.ts` (`wallClockToUtc`, `weekdayInTz`,
`subtractIntervals`, `generateStartTimes`). UI actions and (later) the chatbot
tool layer call the domain — they never re-implement any of it.

### Availability inputs

Working hours (tenant default, overridden per barber) → minus that day's break →
minus one-off `BlockedTime` (time off / vacation / manual, tenant-wide or
per-barber) → minus a closed `Holiday` → minus existing slot-holding
appointments expanded by their own buffer. Then start times are generated on a
**global** `slotGranularityMin` grid (anchored at the epoch, not at each free
interval's start — a buffer must not push every later slot off :00/:15/:30/:45),
bounded by `minLeadTimeMin` and `maxAdvanceDays`.

### Time zones

Working hours are minutes-of-day in `Tenant.timezone`. Appointment instants are
`timestamptz`. `wallClockToUtc` (DST-aware via `@date-fns/tz`) converts a local
date + minute to the correct UTC instant; the UI formats back with `Intl.*` in
the tenant's zone. The server never assumes its own clock zone. Verified: the
same wall-clock in `America/Sao_Paulo`, `America/New_York` and `Europe/Madrid`
produces three different stored instants.

### Conflict prevention — three layers

1. **Availability check** (`assertBookable`) — the requested time must fall on a
   free window for that barber.
2. **SERIALIZABLE transaction** — inside `createAppointment` /
   `rescheduleAppointment`, re-query for any overlapping slot-holding
   appointment (respecting both appointments' buffers) immediately before the
   write; retry up to 3× on `P2034` serialization failures.
3. **Postgres GiST exclusion constraint** `appointment_no_overlap`
   (`EXCLUDE USING gist (employeeId WITH =, tstzrange(startsAt, endsAt, '[)') WITH &&) WHERE status IN (PENDING, CONFIRMED, IN_PROGRESS, COMPLETED)`)
   — the last line of defence. A racing writer that passes layer 2 hits `23P01`,
   which the domain translates to `SLOT_TAKEN`.

The enum value `IN_PROGRESS` is added in one migration and the constraint that
references it is recreated in the next (Postgres forbids using a new enum value
in the transaction that adds it).

Concurrency is covered by an integration test: two simultaneous
`createAppointment` calls for the same slot → exactly one succeeds, one throws
`SchedulingError`, and the DB holds a single row.

### Service snapshot

`Appointment` stores `serviceName`, `durationMin`, `bufferMin`, `priceCents`,
`currency` at booking time. Later edits to the `Service` never rewrite history.

### Status lifecycle

`PENDING → CONFIRMED → IN_PROGRESS → COMPLETED`, with `CANCELED` / `NO_SHOW` as
side exits. Allowed transitions are a data table (`ALLOWED_TRANSITIONS`);
lifecycle timestamps (`confirmedAt`, `startedAt`, `completedAt`, `noShowAt`,
`canceledAt`) are stamped on transition. Deactivating a barber only flips
`Employee.status` — appointment history is untouched.

### RBAC

`OWNER`/`MANAGER` manage team + services + any agenda (`appointment.manageAll`).
`BARBER` gets read-only team/services, `employee.self.write` (own bio / phone /
photo / specialties + own time off), and `appointment.write` scoped to their own
agenda (enforced in `assertCanManageAppointment` by matching
`Employee.userId`).

## Consequences

- The public page and chatbot slices add a thin adapter over the same domain —
  no rule duplication, no drift.
- Buffer is enforced in the availability computation and the serializable
  re-check, but **not** in the DB constraint (which sees only `startsAt`/
  `endsAt`). The constraint still guarantees no hard overlap; buffer is a
  business rule. Documented so a future change (e.g. storing buffer in `endsAt`)
  is a deliberate choice.
- `getAvailableSlots` runs a handful of indexed queries per call; fine for
  interactive use. If the public page needs heavier throughput later, cache per
  `(tenant, service, date, employee)` with short TTL.
