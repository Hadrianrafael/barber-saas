# ADR 0011 — Growth suite: import, campaigns, loyalty, reviews + Super Admin

**Status:** accepted · **Date:** 2026-09-06

## Context

Slice 11 bundles the retention/growth features and completes the platform
console. Common thread: they all reuse existing primitives (messaging dispatch,
consent policy, CRM segments, the public-token pattern, the impersonation hooks
already in the session layer).

## Decisions

### Import (`src/features/import/`)

- **CSV only.** A dependency-free parser (`csv.ts`) handles quotes, escaped
  quotes, embedded commas and CRLF — what Excel / Sheets / Numbers export. XLSX
  would need a heavyweight or advisory-prone dependency; users export CSV
  instead. XLSX is a documented follow-up.
- Flow: upload → `parseAndValidate` (persists a `ContactImport` in `previewed`
  state with a full row-level `report` JSON: `ok` / `duplicate` / `error` +
  per-row errors, counts) → the wizard shows the preview → `confirmImport`
  inserts `ok` rows (opt-in checkbox to also take `duplicate` rows) as
  `Customer(source = IMPORT)`. **No `CommunicationConsent` is ever created** —
  imported contacts have no marketing opt-in. Second confirm is refused
  (`status` guard). 2 MB / 5000-row caps. `import.run` permission.

### Campaigns (`src/features/campaigns/`)

- `Campaign` + `Message(campaignId, category = "marketing")` — no new model.
- Audience = a `SegmentId` + params fed straight into the Slice 4
  `segmentWhere()` builder, so the CRM list, chatbot and campaigns segment
  identically.
- **Marketing requires an explicit opt-in on every channel** (email included),
  matching `canContact(…, "marketing")`. `estimateRecipients` and the worker's
  audience query both filter on a granted, non-revoked `CommunicationConsent`
  for the channel; the worker also re-checks `canContact` per recipient. A
  campaign can never reach someone who never opted in.
- `launchCampaign` only flips DRAFT/SCHEDULED → RUNNING, records
  `totalRecipients`, and enqueues a `campaign` BullMQ job. **All delivery runs
  in the worker** (`deliverCampaign`): pages the audience by id cursor, renders
  `{{nome}}` / `{{barbearia}}` / `{{barbeiro}}` / `{{ultimo_servico}}` /
  `{{link_agendamento}}`, and calls the same `sendMessage()` as transactional
  mail (so the retry job follows up on failures). Counts (`sentCount` /
  `failedCount`) update per page; status → COMPLETED at the end.

### Loyalty (`src/features/loyalty/`)

- Config on `Tenant.loyaltyConfig` (JSON, `loyaltyConfigSchema`): `enabled`,
  `pointsPerVisit`, `pointsPerCurrencyCents` (0 = no value bonus),
  `pointsExpireDays`. Per-service override `Service.loyaltyPoints`.
- `earnForCompletedAppointment` is called fire-and-forget from the scheduling
  `transition` COMPLETED handler. **Idempotent** via
  `@@unique([appointmentId, reason])` on `LoyaltyTransaction` (checked first,
  unique violation caught as a race backstop).
- `LoyaltyReward` catalogue (discount / free_service / custom).
  `redeemReward` debits points (`LoyaltyTransaction` negative) and mints a
  single-use `Coupon` (`LOYAL-XXXX`) carrying the discount — applied manually at
  the till / next payment link for now (coupon→checkout wiring is a follow-up).
  `adjustPoints` for manual corrections. `loyalty.manage` permission
  (OWNER/MANAGER).

### Reviews (`src/features/reviews/`)

- `Review` model (already existed). Public submission at
  `/barber/{slug}/review/{token}` — reuses the booking's `Appointment.publicToken`
  (SHA-256), only a `COMPLETED` appointment, one review per appointment
  (`@@unique appointmentId`), created **unpublished**. A "Leave a review" link
  appears on the booking confirmation page once completed.
- Staff `/reviews` (`review.moderate`): overall + per-barber averages **over
  published reviews only**, filter pending/published/all, approve/hide.
  `Review` has no `employee` relation — barber names are resolved with a
  follow-up `findMany`.

### Super Admin (`src/features/admin/`, `/admin/*`)

- `platformMetrics` (tenants by status, ~MRR from active PLATFORM subscriptions,
  client-payment GMV + platform fees, message status counts, campaigns),
  `/admin/tenants` (search + status filter + paging), `/admin/tenants/[id]`
  (members, subscription, Connect status, recent payments, 30-day message
  usage), `/admin/audit` (platform-wide `AuditLog` with an action filter).
- **Impersonation** was already wired in the session layer
  (`Session.impersonatedTenantId`, `resolveActiveTenant` → OWNER on that tenant).
  `impersonateTenantAction` (admin-session-gated) revokes any existing app
  session on the browser, mints a **non-admin** app session for the admin's own
  user with `impersonatedTenantId` set, and audits
  `admin.impersonation.start` (with the impersonated owner's email in metadata).
  A persistent amber banner in the tenant app shows the target and an **Exit**
  button (`stopImpersonationAction` → revoke + clear cookie + back to `/admin`,
  audited). The admin-session cookie is never touched.

## Consequences

- XLSX import, coupon auto-application at checkout, loyalty point expiry
  enforcement (config field exists, no sweep job yet), scheduled campaigns
  (`Campaign.scheduledAt` exists, no cron picks it up yet), and an auto
  "review request" message after completion are all follow-ups.
- Campaign delivery is single-worker sequential per page; very large audiences
  would benefit from fan-out jobs. Counts are eventually-consistent (updated per
  200-row page).
- The admin console copy is static pt-BR (internal tool), consistent with the
  existing `/admin` realm.
