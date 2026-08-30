# ADR 0002 — Authentication approach

**Status:** accepted · **Date:** 2026-08-29

## Context

Need: e-mail/password auth, e-mail verification, password reset/change, secure
sessions, RBAC with tenant + role context, and a **fully separate** Super Admin
realm. Must be production-grade for a commercial launch.

## Decision

**Hand-rolled opaque server-side sessions + bcrypt**, not a third-party auth
framework.

- **Sessions:** 256-bit random token in an httpOnly / `secure` / `SameSite=Lax`
  cookie. Only `sha256(token)` is persisted (`Session` table). Lookups are
  Redis-cached ~10 s. Revocation = delete row + bust cache. Two cookie
  namespaces: `barber_session` and `barber_admin_session` (shorter TTL). Password
  reset revokes all of a user's sessions.
- **Passwords:** `bcryptjs` cost 12 — pure JS (no native build on Windows /
  bleeding-edge Node), and an OWASP-acceptable hash. `needsRehash()` upgrades
  cost transparently on next successful login.
- **Tokens** (verify / reset): single-use, hashed at rest, time-boxed.
- **RBAC:** see ADR 0001 and `src/server/rbac/`.

## Alternatives considered

- **Auth.js (NextAuth v5)** — still beta; its Credentials + custom
  verification/reset + multi-tenant session + separate admin realm would need as
  much custom code as this, with less control over the two-realm split and
  session revocation semantics.
- **Lucia** — the library is deprecated (author now recommends copy-paste). The
  session design here follows the same principles.
- **argon2id** (`@node-rs/argon2`) — preferred by OWASP, but native prebuilds on
  the current toolchain are a risk for "must run now". bcrypt 12 is fine for
  launch; migrating is a `hashPassword` swap + `needsRehash` already handles the
  rolling upgrade. **Upgrade path, not a blocker.**

## Consequences

- Full control over the two session realms and revocation.
- We own ~250 lines of auth code — covered by unit tests (`password.test.ts`)
  and E2E (Slice 1/12).
- Social login / SSO, if ever needed, is additive (new sign-in method feeding
  the same `Session` model).
