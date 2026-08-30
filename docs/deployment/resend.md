# Resend setup (transactional e-mail)

## Environment

| Var | Notes |
|---|---|
| `RESEND_API_KEY` | `re_...` — from resend.com → API Keys. Empty ⇒ dev **console transport** (messages are logged, `Message.provider = "console"`, status `SENT` so flows work end-to-end) — but nothing is actually delivered. |
| `EMAIL_FROM` | e.g. `"Barbearia X <no-reply@yourdomain.com>"`. The domain must be **verified** in Resend. |

`isConfigured.resend` is true when `RESEND_API_KEY` is set.

## Domain

Add and verify your sending domain in Resend (SPF + DKIM DNS records). Until it's
verified, Resend rejects sends from that domain.

## What gets sent

`src/features/messaging/` renders `src/features/messaging/templates.ts` (pt-BR /
en / es, `{{var}}` interpolation, per-tenant overrides via `MessageTemplate`)
and dispatches through `sendMessage()`, which records a `Message` row and its
lifecycle (`QUEUED → SENT → …`, `FAILED` with backoff `nextAttemptAt`). Triggers:

| Template key | Trigger |
|---|---|
| `appointment_confirmation` | appointment created (non-import) |
| `appointment_reminder` | `cron:reminders` (default 24h before; `bookingConfig.reminderLeadHours`) |
| `appointment_canceled` | appointment canceled |
| `appointment_rescheduled` | appointment rescheduled |
| `payment_link` | payment link created with `notify` |
| `payment_received` | (wired point — send from the Connect `checkout.session.completed` handler when desired) |
| `customer_recovery` | campaign (Slice 11) |

Failed messages are retried by `cron:retry-messages` (every ~5 min) up to 5
attempts with exponential backoff.

## Auth e-mails

Sign-up verification and password reset use `src/server/mail` directly (also
Resend / console). Same `RESEND_API_KEY`.

## Test locally

Leave `RESEND_API_KEY` empty → e-mails print to the console with the full body.
Set a real key + verified `EMAIL_FROM` to send for real. `/messages` shows the
delivery log with status.
