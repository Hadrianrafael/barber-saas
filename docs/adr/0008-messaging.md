# ADR 0008 — Messaging (transactional e-mail + WhatsApp)

**Status:** accepted · **Date:** 2026-09-03

## Context

Barbershops need to reach customers for appointment lifecycle events
(confirmation, reminder, cancellation, reschedule) and payment links, in the
customer's language, over the channel the customer consented to. Slice 11 adds
bulk campaigns on top of the same primitives. Credentials (Resend, WhatsApp
Cloud API) may not be configured at build time and must never be simulated.

## Decision

### Layers (`src/features/messaging/`)

| Module | Responsibility |
|---|---|
| `templates.ts` | System templates keyed by `TemplateKey` × channel × locale (pt-BR/en/es). `{{var}}` interpolation, unknown vars → "", whitespace collapsed. `renderTemplate()` accepts a per-tenant `MessageTemplate` override; EMAIL gets an HTML-escaped body + subject, WhatsApp/SMS get text only. |
| `consent.ts` | `canContact(customerId, channel, category)`. WhatsApp/SMS require an explicit granted `CommunicationConsent` for both transactional and marketing. E-mail transactional is allowed unless the customer opted out; marketing needs opt-in. Anonymised / `BLOCKED` customers → never. |
| `channels.ts` | `sendViaEmail` (Resend, or **console** transport when `!isConfigured.resend`), `sendViaWhatsApp` (real `POST graph.facebook.com/v21.0/{id}/messages`, throws `MessagingNotConfiguredError` when unconfigured). `MessagingSendError` carries `retriable` (5xx / 429). |
| `dispatch.ts` | `sendMessage()` persists a `Message` row (`QUEUED`), calls `attemptSend()`, then sets `SENT` (+ `provider`, `providerMessageId`, `sentAt`) or `FAILED` (+ `error`, `attempts++`, `nextAttemptAt` backoff when retriable and `attempts < 5`). `retryDueMessages(limit)` re-drives `FAILED` rows whose `nextAttemptAt` is due. Backoff minutes `[1, 5, 30, 120, 360]`. |
| `notify.ts` | `notifyAppointment(appointmentId, key, extra)` / `notifyPaymentLink(id)` — load context, format datetime with `Intl.DateTimeFormat` in the tenant timezone + customer locale, pick channels `[WHATSAPP, EMAIL]` filtered by `canContact`, render, `sendMessage`. **Stops at the first channel that reaches `SENT`**; a failed channel falls through to the next. |
| `log.ts` | `listMessages()` — paginated, filterable by channel/status/direction, with per-status counts. Backs `/messages`. |

### Triggers are async, never in the request path

`src/features/scheduling/appointments.ts` and `payments/links.ts` call a
fire-and-forget `notifyAsync()` that enqueues a BullMQ job
(`enqueueAppointmentNotification`). The worker
(`src/worker/processors/messaging.ts`) runs `notifyAppointment`. Nothing about a
booking succeeding or failing depends on message delivery.

Keys wired: `appointment_confirmation` (on create, unless `source = IMPORT`),
`appointment_rescheduled`, `appointment_canceled` (with `{reason}`),
`payment_link` (when `createPaymentLink({ notify: true })`).

### Reminder + retry crons

- `src/worker/cron/reminders.ts` (`npm run cron:reminders`) — for each
  ACTIVE/TRIALING/PAST_DUE tenant, `bookingConfig.reminderLeadHours` (default
  24), find PENDING/CONFIRMED appointments with `reminderSentAt = null` inside a
  ±30 min window of the lead time, stamp `reminderSentAt`, enqueue
  `appointment_reminder`. The stamp is set **before** enqueue so a crash can't
  double-send.
- `src/worker/cron/retry-messages.ts` (`npm run cron:retry-messages`) —
  `retryDueMessages(200)` every ~5 min.

Both are Azure Container Apps **scheduled jobs** in production.

### WhatsApp webhook — `/api/webhooks/whatsapp`

`GET` answers Meta's `hub.challenge` when `hub.verify_token ===
WHATSAPP_WEBHOOK_VERIFY_TOKEN`. `POST` verifies `x-hub-signature-256`
(HMAC-SHA256 over the raw body with `WHATSAPP_APP_SECRET`, `timingSafeEqual`),
returns `200` inert when `!isConfigured.whatsapp`, then:

- `value.statuses[]` → `updateMany` `Message` by `(provider, providerMessageId)`
  to `SENT`/`DELIVERED`/`READ`/`FAILED`.
- `value.messages[]` → store inbound `Message` (`direction = INBOUND`),
  best-effort tenant resolution by sender phone == a `Customer.whatsapp`,
  deduped on the provider message id (`@@unique([provider, providerMessageId])`).

### Schema additions

`Message`: `templateKey`, `category` (default `transactional`), `attempts`,
`nextAttemptAt`, `@@unique([provider, providerMessageId])`,
`@@index([tenantId, createdAt])`, `@@index([status, nextAttemptAt])`.
`Appointment.reminderSentAt`. Migration
`20260903000000_slice8_messaging`.

### Config-gated, never simulated

`isConfigured.resend` off → e-mail prints to the console (`provider =
"console"`, status `SENT`) so local flows are exercisable, but the doc is
explicit that nothing is delivered. `isConfigured.whatsapp` off → WhatsApp sends
are recorded `FAILED` with a real backoff, not faked as sent; webhook is inert.
Setup: `docs/deployment/resend.md`, `docs/deployment/whatsapp.md`.

## Consequences

- V1 uses **one shared platform WhatsApp number**. Per-tenant numbers
  (`WhatsAppChannel` with the tenant's own `phoneNumberId`/token) is an additive
  follow-up — `dispatch`/`notify` already resolve channel config per message.
- Business-initiated WhatsApp messages outside the 24 h window require
  Meta-approved templates per key/locale; free-form text only works in-session.
- No provider abstraction interface yet for messaging (unlike payments) — Resend
  and the Cloud API are called directly. A second e-mail/WhatsApp vendor would
  refactor `channels.ts` behind an interface.
- Inbound message → conversation threading is minimal (stored, tenant-matched);
  the Conversations panel + AI/human handoff is Slice 10.
