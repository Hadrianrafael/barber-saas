# WhatsApp setup (Meta WhatsApp Cloud API)

Outbound messages use the official **WhatsApp Cloud API**
(`graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`). Delivery receipts and
inbound replies arrive on the webhook `/api/webhooks/whatsapp`.

## Environment

| Var | Notes |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → API Setup. The sending number's ID. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID — used for template management. |
| `WHATSAPP_ACCESS_TOKEN` | Permanent System User token with `whatsapp_business_messaging` + `whatsapp_business_management`. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Any random string you also paste into the Meta webhook config (GET handshake). |
| `WHATSAPP_APP_SECRET` | Meta App → Settings → Basic. Used to verify `x-hub-signature-256` on every POST. |

`isConfigured.whatsapp` is true only when phone number id + access token are set.
When it is false: outbound WhatsApp sends are recorded as `Message` rows with
status `FAILED` / `error = "whatsapp not configured"` and a `nextAttemptAt`
backoff (they are **not** simulated as sent); the webhook returns `200` inert.

## Webhook

1. Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
2. Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
3. Subscribe fields: `messages`
4. The `GET` handler answers Meta's `hub.challenge`; the `POST` handler verifies
   the HMAC-SHA256 signature with `WHATSAPP_APP_SECRET` (constant-time compare),
   then applies `statuses[]` (→ `SENT`/`DELIVERED`/`READ`/`FAILED` by
   `provider + providerMessageId`) and stores inbound `messages[]` (best-effort
   tenant match by sender phone == a `Customer.whatsapp`).

## Templates (business-initiated messages)

Outside the 24-hour customer-service window, Meta only delivers **approved
message templates**. Submit templates in Meta for the keys used here
(`appointment_confirmation`, `appointment_reminder`, `appointment_canceled`,
`appointment_rescheduled`, `payment_link`) in pt-BR / en / es. Session replies
(within 24h of a customer message) can use free-form text.

## Pilot limitation → per-tenant numbers

V1 ships a **single platform WhatsApp number** shared by all tenants (the env
vars above). Roadmap follow-up: per-tenant `WhatsAppChannel` rows holding each
barbershop's own `phoneNumberId` / token so replies and sender identity are
tenant-scoped. The `notify`/`dispatch` layer already selects channel config per
message, so this is an additive change (no call-site changes).

## Test locally

Leave the vars empty → WhatsApp sends fail cleanly and fall through to e-mail
(`notifyAppointment` tries `WHATSAPP` then `EMAIL`). With real credentials, book
an appointment for a customer whose `whatsapp` is set and who has a granted
`WHATSAPP` consent row, then watch `/messages` for `SENT → DELIVERED → READ`.
