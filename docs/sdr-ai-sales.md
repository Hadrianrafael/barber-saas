# SDR / AI Sales Assistant

An internal, **platform-scoped** module (no tenant) that lets HR Tech prospect
barbershops to become customers. Lives entirely under `/admin/sales` and is
gated by `requireAdminSession()` (platform admins only).

> **The module ships in TEST MODE.** No message reaches a real lead until a
> platform admin records a lawful basis per lead **and** flips production on at
> `/admin/sales/settings`. `SDR_TEST_MODE=true` (env) is a hard kill-switch that
> overrides everything.

## Pieces

| Area | Files |
|---|---|
| Data model | `prisma/schema.prisma` (`Sales*`), migration `20260908000000_sdr_ai_sales_module` |
| Adapters | `src/server/ai/openai.ts` (chat/transcribe/tts), `src/server/voice/index.ts` (provider abstraction), `src/server/whatsapp/index.ts` (Cloud API) |
| Core | `src/features/sdr/*` — `phone`, `schema`, `import`, `leads`, `suppression`, `settings`, `guard`, `agent-config`, `conversation`, `agent`, `qualification`, `outbound`, `inbound`, `campaigns`, `inbox`, `metrics`, `actions` |
| Async | queues `sdr-inbound` / `sdr-outbound` (`src/worker/queues.ts`, `src/worker/processors/sdr.ts`), cron `src/worker/cron/sdr-dispatch.ts` (Bicep job `*-cron-sdr`, every 5 min) |
| Webhook | `src/app/api/webhooks/whatsapp/route.ts` also enqueues `sdr-inbound` and mirrors status callbacks onto `SalesMessage` |
| UI | `src/app/(admin)/admin/sales/**` |

## Compliance model — the single choke point

Every outbound send goes through `guard.assertContactable(lead, channel)`, in order:

1. recipient exists for the channel
2. lead not `OPT_OUT` / `optOutAt`
3. lead not `SEM_INTERESSE`
4. recipient not on the **suppression list** (`SalesSuppression`)
5. **TEST MODE** → recipient must be on the test allowlist, else blocked
6. **PRODUCTION** → the lead must have a `consentBasis` (`OPT_IN` /
   `LEGITIMATE_INTEREST` / `EXISTING_RELATIONSHIP`) recorded by a human
7. global daily cap (`SalesSetting.dailyGlobalCap`) not exceeded

A blocked attempt is still written as a `FAILED` `SalesMessage` with the reason —
never silently dropped. Inbound opt-out phrases (pt/en/es) are detected on every
message and immediately opt the lead out + suppress every contact point.

## Conversation flow (inbound)

`webhook → enqueueSdrInbound → processInbound`:
idempotent on `providerMessageId` → (audio) download + Whisper transcription →
opt-out check → persist inbound → if a human owns the conversation, stop and
alert → else `runAgentTurn` (OpenAI, strict prompt) → `qualifyFromTranscript`
(heuristics + optional LLM extraction) → score → `FRIO/MORNO/QUENTE` → if
`QUENTE` or the agent flags it, set `handledBy=HUMAN`, lead `HUMANO`, raise an
alert event → send reply (text or audio per `replyMode`, mirroring the lead's
modality on `MIXED`).

Context is windowed: last 12 turns verbatim; older turns are summarised into
`SalesConversation.contextSummary` once past 20 turns. The model never receives
unbounded history.

## The AI never invents

`agent.buildSystemPrompt` composes the system prompt from `SalesAgentConfig`
(`content` per locale + `knowledge`). Hard rules baked in: never state a price,
discount, feature, integration or commercial condition that isn't in the
knowledge base; when unsure, defer to the demo / a human and ask a qualifying
question; end with `[[HANDOFF]]` for a human or `[[STOP]]` to close. With
`OPENAI_API_KEY` unset, a deterministic fallback reply is used (keeps TEST MODE
demoable) — it is clearly not a fabricated sales claim.

## Voice

`getVoiceProvider()` returns the `external` provider only when
`VOICE_PROVIDER=external` **and** `EXTERNAL_VOICE_BASE_URL` + `EXTERNAL_VOICE_API_KEY`
are set; otherwise it falls back to OpenAI TTS with a warning. No custom/cloned
voice id is ever invented — it comes from `EXTERNAL_VOICE_ID`. Generated audio is
stored via the storage driver and sent as a WhatsApp audio message.

## Campaigns (paced, never a blast)

`sdr-dispatch` runs every 5 min. Per `RUNNING` campaign it releases **at most one**
first-touch, and only when: inside `[windowStartMin, windowEndMin]` on an allowed
`sendDays` weekday (campaign `timezone`); at least `minIntervalSec` ± `jitterPct`
since `lastDispatchAt`; and the per-campaign `dailyCap` (default 30) isn't
reached. First-touch copy comes from the active agent config for the campaign
locale; `firstTouch=AUDIO` synthesises it. Campaigns start in `mode=TEST`.

## Env

See `docs/deployment/environment-variables.md` and `docs/deployment/keyvault.md`.
All SDR secrets are optional; non-secret tuning (`OPENAI_MODEL`,
`OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`,
`VOICE_PROVIDER`, `SDR_TEST_MODE`) is in `infra/main.bicep` `appEnv`.

## Tests

`tests/unit/sdr.test.ts` — phone/dedupe normalisation, spreadsheet header
auto-mapping, opt-out detection (pt/en/es), qualification scoring + tiers, the
timezone send-window calc, template rendering. Integration coverage (import
commit, guard, idempotency, handoff) runs against the CI Postgres.
