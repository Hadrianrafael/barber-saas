# Chatbot setup (Anthropic)

The chatbot answers customers on the public barbershop page (web chat widget) and
is wired to the real backend — it never invents prices, availability or policy.

## Environment

| Var | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` from console.anthropic.com. Empty ⇒ `isConfigured.chatbot` is false: the widget still opens, but every message goes straight to the **human queue** (`Conversation.status = PENDING_HUMAN`). No reply is ever faked. |
| `CHATBOT_MODEL` | Defaults to `claude-sonnet-5`. Any current Messages-API model id. |

No SDK dependency — the Messages API is called directly over `fetch`
(`src/features/chatbot/anthropic.ts`, `anthropic-version: 2023-06-01`).

## Per-tenant configuration

Settings → **Chatbot** tab (`tenant.settings.write`):

- **Enable automatic AI replies** — off by default. Off ⇒ human queue only.
- **Display name**, **greeting** per language (pt-BR / en / es; falls back to a
  built-in greeting).
- **AI instructions** — tone / house notes appended to the system prompt. Cannot
  grant capabilities.
- **Handoff keywords** — if a message contains one, it skips the model and goes
  straight to a human.

Stored as `Tenant.chatbotConfig` (JSON, validated by
`src/features/chatbot/config.ts`). Migration `20260905000000_slice10_chatbot`.

## What the assistant can and cannot do

Capabilities are **fixed in code** (`src/features/chatbot/tools.ts`) — they are
not a member role and tenant config cannot widen them. Every tool is
hard-scoped to the conversation's `tenantId` and, for anything customer-specific,
to the single customer bound to the conversation via `identify_customer`.

| Tool | Scope |
|---|---|
| `list_services`, `list_barbers`, `check_availability` | tenant, read-only, same data the public page shows |
| `identify_customer` | dedupes/creates a customer, links it to the conversation |
| `my_appointments`, `book_appointment`, `cancel_appointment`, `reschedule_appointment` | ONLY the identified customer's own appointments; goes through the scheduling domain (hours, lead time, double-booking, buffers all still enforced) |
| `create_payment_link` | one of that customer's appointments, only when Stripe Connect is enabled for the tenant |
| `handoff_to_human` | sets `status = PENDING_HUMAN` |

It can **never** touch other customers, finance totals, team/roster, shop
settings, campaigns or audit logs. There is no tool for those.

## Conversations panel (staff)

`/{locale}/conversations` (`conversation.read`). Take over
(`conversation.handle`) → `handledBy = HUMAN`, the AI stops replying; reply
inline; "Return to AI" hands it back. Tool calls are visible with a toggle.

## Web-chat session security

The widget gets an opaque 24-byte session token; only its SHA-256 hash is stored
(`Conversation.externalId`). Every customer request is matched by
`{ id, externalId hash, channel: WEBCHAT }`, so one visitor cannot read another's
thread. Rate limits: start 20 / 5 min, send 30 / 2 min per IP. Agent loop is
capped at 6 tool round-trips and a 30 s timeout; on any failure it degrades to a
human handoff.

## Test locally

Leave `ANTHROPIC_API_KEY` empty → open the widget on `/{locale}/barber/{slug}`,
send a message, see it appear under `/{locale}/conversations` as
`PENDING_HUMAN`. Set a real key + enable the chatbot in Settings to get live
tool-grounded replies.
