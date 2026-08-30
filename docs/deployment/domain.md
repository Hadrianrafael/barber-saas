# Custom domain, HTTPS and URLs

The app is domain-agnostic — everything derives from `APP_URL`. Pick a domain
for the SaaS (it does **not** have to be `hrtechsistemas.com.br`; a subdomain or a
new domain is fine). **DNS is never changed automatically** — every record below
is something you add at your registrar / DNS provider.

## 1. Choose the hostnames

| Environment | Hostname (example) | `APP_URL` |
|---|---|---|
| staging | `staging.barberapp.com` | `https://staging.barberapp.com` |
| production | `app.barberapp.com` (or the apex `barberapp.com`) | `https://app.barberapp.com` |

Use one hostname per environment. Do not point staging and prod at the same app.

## 2. Bind the domain to the Container App

```bash
# 1. get the app's default FQDN + the validation token
az containerapp hostname add   -g barber-staging -n barber-staging-web \
  --hostname staging.barberapp.com
az containerapp show -g barber-staging -n barber-staging-web \
  --query "properties.customDomainVerificationId" -o tsv
```

At your DNS provider add:

| Record | Name | Value |
|---|---|---|
| `CNAME` | `staging` (or `app`) | the Container App default FQDN (`barber-staging-web.<region>.azurecontainerapps.io`) |
| `TXT` | `asuid.staging` (or `asuid.app`) | the `customDomainVerificationId` from above |

For an **apex/root** domain (`barberapp.com`) use an `A` record to the
environment's static inbound IP (`az containerapp env show … --query
properties.staticIp`) plus the `asuid` TXT on `asuid` (no subdomain label), or
use an ALIAS/ANAME if your provider supports it.

Then bind a **free managed certificate**:

```bash
az containerapp hostname bind -g barber-staging -n barber-staging-web \
  --hostname staging.barberapp.com --environment barber-staging-cae \
  --validation-method CNAME
# Azure issues + auto-renews the cert once the CNAME/TXT resolve.
```

Verify: `curl -sI https://staging.barberapp.com/api/health/live` → `HTTP/2 200`,
no TLS warning.

## 3. Set `APP_URL` and redeploy

`APP_URL` feeds every absolute link — e-mail buttons, the public booking link
(`{{link_agendamento}}`), Stripe `success_url` / `cancel_url`, the payment-link
return URLs. It must be the **final HTTPS hostname**.

```bash
az deployment group create -g barber-staging -f infra/main.bicep \
  -p namePrefix=barber environment=staging image=<same tag> \
     pgAdminLogin=barberadmin pgAdminPassword='<unchanged>' \
     appUrl=https://staging.barberapp.com
```

(or a quick `az containerapp update -g barber-staging -n barber-staging-web
--set-env-vars APP_URL=https://staging.barberapp.com`).

## 4. URLs that depend on the domain

Fill these in the corresponding dashboards **after** step 3. Until the domain is
bound, use placeholders and come back.

| Purpose | Staging | Production | Where to set |
|---|---|---|---|
| App base (`APP_URL`) | `https://staging.<domain>` | `https://<domain>` | Bicep param / Container App env |
| Stripe **platform** webhook | `https://staging.<domain>/api/webhooks/stripe` | `https://<domain>/api/webhooks/stripe` | Stripe → Developers → Webhooks |
| Stripe **Connect** webhook | `https://staging.<domain>/api/webhooks/stripe/connect` | `https://<domain>/api/webhooks/stripe/connect` | Stripe → Webhooks (Connect) |
| Stripe Checkout return URLs | `https://staging.<domain>/{locale}/billing?checkout=…` and `/{locale}/pay/{success,canceled}` | same on prod | **automatic** — built from `APP_URL` in code, nothing to configure |
| Stripe Connect onboarding return/refresh | `https://staging.<domain>/{locale}/payments?connect=…` | same on prod | **automatic** — built from `APP_URL` |
| WhatsApp webhook callback | `https://staging.<domain>/api/webhooks/whatsapp` | `https://<domain>/api/webhooks/whatsapp` | Meta app → WhatsApp → Configuration |
| Resend sending domain | `<domain>` (or a subdomain like `mail.<domain>`) | same | resend.com → Domains (SPF/DKIM records) |
| Super Admin | `https://<domain>/admin` | same | — (same app) |

## 5. CORS / callbacks

- **No CORS configuration is needed.** The browser only ever talks to the app's
  own origin; all third-party calls (Stripe, Anthropic, Meta) are
  **server-to-server**. Stripe redirects are full-page navigations, not XHR.
- There is **no OAuth callback** to register: Stripe Connect uses Express +
  Account Links (not the OAuth flow), and there is no "sign in with Google" etc.
- The CSP in `next.config.ts` already allows `connect-src` /`frame-src` for
  `api.stripe.com`, `js.stripe.com`, `hooks.stripe.com`, `api.anthropic.com`,
  `graph.facebook.com`. If you add another third party later, add it there.

## 6. Email deliverability records (summary — detail in `resend.md`)

At the DNS zone of your sending domain:

| Record | Purpose |
|---|---|
| `TXT` SPF (`v=spf1 include:…resend… ~all`) | authorise Resend to send |
| `CNAME`×2–3 DKIM (values from Resend) | sign the mail |
| `TXT` `_dmarc` (`v=DMARC1; p=quarantine; rua=mailto:…`) | policy + reports (recommended) |

## 7. Do NOT

- change DNS for anything other than the records above,
- point the SaaS at `hrtechsistemas.com.br` without deciding that on purpose,
- expose the Container App's `*.azurecontainerapps.io` URL as the public
  address once the custom domain is live (it still works, but links use
  `APP_URL`).
