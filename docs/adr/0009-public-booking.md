# ADR 0009 — Public booking flow

**Status:** accepted · **Date:** 2026-09-04

## Context

Slice 2 shipped the public barbershop page with a disabled "Book" button; the
scheduling domain (ADR 0005) was built to be shared. Slice 9 wires the
customer-facing booking flow on `/[locale]/barber/{slug}/book` in all three
languages, ending in confirmation and — when the shop has Stripe Connect live —
online payment.

## Decision

### One domain, one entry point

`src/features/booking/service.ts` is the only public caller of the scheduling
domain. `createPublicBooking()` does **no** availability maths of its own — it
delegates every rule (lead time, advance-limit, working hours, holidays,
blocked time, buffers, double-booking via the serializable tx + GiST
constraint) to `createAppointment()`. "Any available barber" is resolved
server-side by asking `getAvailableSlots()` and picking the first employee whose
real slot list contains the requested instant (never trusting the client's
choice).

### Flow

`service → barber (or "any") → date → slot → details → confirm`. Slots are
fetched through `publicSlotsAction` (a thin wrapper, IP rate-limited 60/min),
flattened to one bookable barber per instant. Submission is a Server Action
(`submitBookingAction`, 10 / 5 min per IP) returning `{ token, checkoutUrl? }`;
the client redirects to Stripe Checkout when paying, otherwise to the
confirmation page.

### Customers & consent

`resolveOrCreateCustomer()` dedupes on the tenant-unique `email` / `phone`
before creating a `Customer` tagged `source = PUBLIC_PAGE`. **No consent is ever
assumed** — a booking only grants a `CommunicationConsent(WHATSAPP, granted)`
(`source = "public_form"`) when the customer explicitly ticks the reminders box
and gave a phone. Transactional e-mail needs no opt-in (per ADR 0008 policy).

### Self-service without accounts

`Appointment.publicToken` stores the SHA-256 hash of a 24-byte token handed to
the booker in the confirmation URL (and, later, notifications). The
`/[locale]/barber/{slug}/booking/{token}` page shows status + lets the customer
cancel / reschedule online while more than `bookingConfig.clientCancellationCutoffHours`
away from the start — reusing `cancelAppointment` / `rescheduleAppointment`.
All these pages are `robots: noindex`.

### Payment

When `payNow` is set and Connect is enabled for the tenant,
`createPublicBooking` calls the existing `createPaymentLink()` (Checkout Session
on the connected account, `application_fee`, `metadata.appointmentId`). The
booking is created **PENDING first** — a payment-setup failure logs and leaves
the appointment bookable in person, never lost. On the Connect webhook
`checkout.session.completed`, the payment row is written and, idempotently
(`updateMany … status: PENDING`), the appointment is moved to `CONFIRMED` and an
`appointment_confirmation` notification is enqueued.

## Consequences

- No slot "hold" during checkout — a slot can be taken by someone else while the
  first customer is on the Stripe page; the webhook/return then fails cleanly
  with `SLOT_TAKEN` and no charge is captured (Checkout authorises on
  completion). A short-lived reservation row is a future refinement.
- `publicToken` is unguessable (192-bit) and single-purpose; there is no
  enumeration surface. It is not rotated on reschedule.
- Deposits / partial prepayment are not modelled — `payNow` charges the full
  service price snapshot. Deposit rules would extend `bookingConfig`.
