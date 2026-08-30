# ADR 0010 — Chatbot (tool-grounded, per-tenant)

**Status:** accepted · **Date:** 2026-09-05

## Context

Customers want to ask about services/prices and book/cancel/reschedule in
natural language, in pt-BR / en / es, on the public page. It must never invent
operational facts, must respect every booking rule, and — critically — **must
not be able to do anything a normal user could not**. Credentials
(`ANTHROPIC_API_KEY`) may be absent.

## Decision

### No SDK — direct Messages API

`src/features/chatbot/anthropic.ts` calls `POST api.anthropic.com/v1/messages`
over `fetch` (`anthropic-version: 2023-06-01`, model `env.CHATBOT_MODEL`,
default `claude-sonnet-5`). Keeps the dependency surface at zero and the
env-gate trivial: `isConfigured.chatbot === false` ⇒ `ChatbotNotConfiguredError`
and the conversation falls to the human queue. A reply is never simulated.

### Capabilities are code, not a role

The assistant is **not** a `MemberRole`. `src/features/chatbot/tools.ts` defines
a fixed set of ~10 tools; `runTool(name, input, ctx)` enforces, by construction:

- every query is filtered by `ctx.tenantId`;
- anything customer-specific is filtered by `ctx.customerId`, which is `null`
  until `identify_customer` resolves/creates the customer and links it to the
  `Conversation`. Appointment tools return `not_identified` before that.
- book / cancel / reschedule go through the **same scheduling domain**
  (`createAppointment` / `cancelAppointment` / `rescheduleAppointment`) as staff
  and public booking — every rule (hours, lead time, buffers, serializable +
  GiST double-booking) still applies.
- there is **no tool** for finance, roster, settings, other customers,
  campaigns or audit. The model cannot reach them because the capability does
  not exist, not because a string check might catch it.

`Tenant.chatbotConfig` (persona, greeting, instructions, handoff keywords) tunes
*voice only*; the schema cannot grant capabilities.

### Agent loop

`src/features/chatbot/agent.ts` — up to 6 tool round-trips, 30 s `AbortController`
timeout. System prompt hard-codes the "never invent / identify first / offer
handoff on error / reply in the customer's language" rules. Every step
(assistant text, tool call + payload, tool result) is persisted as a
`ConversationMessage`; the customer view hides `tool` rows, the staff panel can
show them.

### Channels & handoff

Primary channel: a web-chat widget on `/{locale}/barber/{slug}` (opaque
hashed session token in `Conversation.externalId`, matched per request so
threads are isolated). `handoff_to_human` / a config keyword / AI disabled all
set `Conversation.status = PENDING_HUMAN`. Staff `/{locale}/conversations`
(`conversation.read`) list + thread; "Take over" (`conversation.handle`) sets
`handledBy = HUMAN` and the agent stops responding; "Return to AI" reverses it.
`detectLocale()` seeds the conversation language; the model is also told to
mirror it.

### Rate limits

start 20 / 5 min, send 30 / 2 min, per IP (fixed-window Redis, fail-open).

## Consequences

- WhatsApp inbound (stored since ADR 0008) is **not** yet fed to the agent —
  `postWebCustomerMessage` is channel-specific. Making it channel-agnostic +
  sending the reply back through `dispatch` is a follow-up.
- History replayed to the model is capped at 40 messages and tool rows are not
  replayed — long multi-tool threads lose old tool context.
- One agent turn per customer message runs inline in the Server Action (bounded
  by the 30 s timeout). Moving it to the BullMQ worker with a streamed/polled
  reply is the scale path.
- No spend cap per tenant/conversation beyond the 6-step loop; a usage-metering
  hook belongs with the plan-gating layer (ADR 0006).
