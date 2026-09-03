# Go-live checklist (executável)

Checklist único e verificável para levar a SaaS de `READY FOR CONFIGURATION` até
`READY FOR PRODUCTION`. Faça a coluna **staging** inteira, valide, depois repita
para **production**.

- **Resp.**: `Claude` = já feito no repositório · `Hadrian` = exige sua conta /
  credencial / cartão / domínio / autorização.
- **Validar**: como confirmar que o item está OK.

Passo a passo narrativo: [`GO-LIVE.md`](GO-LIVE.md). Detalhe Stripe:
[`STRIPE.md`](STRIPE.md). Azure: [`deployment/azure.md`](deployment/azure.md).
Key Vault: [`deployment/keyvault.md`](deployment/keyvault.md). Domínio:
[`deployment/domain.md`](deployment/domain.md). Backup:
[`deployment/backup-recovery.md`](deployment/backup-recovery.md). Custos:
[`AZURE-COST-CHECKLIST.md`](AZURE-COST-CHECKLIST.md).

Scripts (nunca imprimem secrets):

| Script | Faz |
|---|---|
| `npm run check:env` | valida variáveis obrigatórias + quais integrações estão configuradas |
| `npm run preflight` | testa conectividade real: Postgres, Redis, Blob, Stripe |
| `npm run smoke -- <url>` | smoke HTTP pós-deploy (`/api/health*`, páginas públicas, webhook) |
| `npm run keyvault:push -- --vault <kv> --file .env.<env>` | envia os secrets locais para o Key Vault |
| `npm run stripe:sync-plans` | cria/atualiza Products/Prices na Stripe a partir das linhas `Plan` |
| `RUN_DB_TESTS=1 npm test` | suíte automatizada (186) |

---

## A. Contas externas

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| A1 | Assinatura Azure com permissão de criar resource groups | Hadrian | portal.azure.com | — | `az account show` retorna a subscription |
| A2 | Conta Stripe ativada para o país + **Connect** habilitado (Express) | Hadrian | dashboard.stripe.com → Settings → Connect → Get started | A1 opcional | Dashboard Stripe abre em Test mode; Connect aparece no menu |
| A3 | Conta Resend + domínio de envio sob seu controle | Hadrian | resend.com | domínio | login no Resend |
| A4 | Meta app + WhatsApp Business Account + número | Hadrian | developers.facebook.com | Business Portfolio | app aparece em "My Apps" |
| A5 | Acesso à API Anthropic | Hadrian | console.anthropic.com | — | consegue criar uma API key |
| A6 | GitHub Actions habilitado + Environment `production` com revisores | Hadrian | repo → Settings → Environments | — | Environment `production` existe |
| A7 | Controle de DNS do domínio da SaaS | Hadrian | seu registrador | domínio comprado | consegue criar registros CNAME/TXT |
| A8 | (opcional) Projeto Sentry | Hadrian | sentry.io | — | tem um DSN |

---

## B. Stripe (Test Mode — **não** Live ainda)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| B1 | Código Stripe: PaymentProvider, Billing, Connect, Payments, Invoicing, Tax(opt-in), webhooks idempotentes, plan gating | Claude | `src/server/payments/`, `src/features/billing/`, `src/features/payments/` | — | `RUN_DB_TESTS=1 npx vitest run tests/integration/billing.int.test.ts tests/integration/connect.int.test.ts` |
| B2 | `Plan.stripeProductId/stripePriceId/stripePriceIdYearly` no schema + `npm run stripe:sync-plans` | Claude | `scripts/stripe/sync-plans.ts` | — | `npx tsc --noEmit` |
| B3 | Copiar `sk_test_…` e `pk_test_…` | Hadrian | Stripe → Developers → API keys (Test mode) | A2 | chaves começam com `sk_test_` / `pk_test_` |
| B4 | Webhook **plataforma** criado (URL em §H, eventos em `STRIPE.md`) | Hadrian | Stripe → Developers → Webhooks → Add endpoint | H, staging deployado | endpoint listado, "Signing secret" copiado (`whsec_…`) |
| B5 | Webhook **Connect** criado ("Listen to events on Connected accounts") | Hadrian | Stripe → Webhooks → Add endpoint | H, staging deployado | endpoint com o badge "Connect", `whsec_…` copiado |
| B6 | Customer portal habilitado (troca de plano, cancelamento, método de pagamento) | Hadrian | Stripe → Settings → Billing → Customer portal | — | página do portal ativa |
| B7 | Perfil Connect (nome da plataforma, ícone, e-mail de suporte, statement descriptor) — Test | Hadrian | Stripe → Connect → Settings | A2 | perfil salvo |
| B8 | Rodar `STRIPE_SECRET_KEY=sk_test_… npm run stripe:sync-plans` contra o DB de staging | Hadrian | terminal | B3, J (DB migrada+seed) | script imprime `product=…` `month=…` para os 3 planos; `SELECT code,"stripeProductId","stripePriceId" FROM "Plan"` preenchido |
| B9 | Decidir `PLATFORM_FEE_BPS` (0 = sem taxa; 200 = 2%) | Hadrian | valor de negócio | — | definido no env da app |
| B10 | `STRIPE_CONNECT_CLIENT_ID` **não é usado** (Express + Account Links, não OAuth) | Claude | `docs/STRIPE.md` | — | — |

---

## C. Resend (e-mail)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| C1 | Código: templates pt/en/es, política de consentimento, retry, `/messages` | Claude | `src/features/messaging/` | — | `RUN_DB_TESTS=1 npx vitest run tests/integration/messaging.int.test.ts` |
| C2 | API key `re_…` | Hadrian | resend.com → API Keys | A3 | key criada |
| C3 | Domínio de envio adicionado + verificado | Hadrian | resend.com → Domains → Add | A7 | status "Verified" |
| C4 | Registros DNS **SPF** + **DKIM** publicados | Hadrian | seu DNS (valores que o Resend mostra) | A7 | Resend marca SPF/DKIM ✓ |
| C5 | **DMARC** (recomendado) — `_dmarc.<domínio> TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@<domínio>"` | Hadrian | seu DNS | C4 | `dig TXT _dmarc.<domínio>` retorna o registro |
| C6 | `EMAIL_FROM` = `"Nome <no-reply@<domínio-verificado>>"` | Hadrian | env da app / Key Vault não (é env comum) | C3 | igual ao remetente verificado |
| C7 | Teste de envio real | Hadrian | criar um agendamento de teste após o deploy | J, K | e-mail chega (não spam); `/messages` mostra `SENT` provider `resend` |

Sem `RESEND_API_KEY` o app usa o **console transport** (`Message.provider = "console"`) — útil no 1º smoke, mas não conta como "e-mail funcionando".

---

## D. WhatsApp (Meta Cloud API — **não** WhatsApp Web)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| D1 | Código: Cloud API oficial (`graph.facebook.com/v21.0`), webhook assinado, opt-in/opt-out, retry | Claude | `src/features/messaging/channels.ts`, `src/app/api/webhooks/whatsapp/route.ts` | — | `npx tsc --noEmit` |
| D2 | **Business Portfolio** (Meta Business) | Hadrian | business.facebook.com | A4 | portfolio criado |
| D3 | **App** do tipo Business com o produto **WhatsApp** adicionado | Hadrian | developers.facebook.com → Create App | D2 | app com "WhatsApp" no menu |
| D4 | **WhatsApp Business Account** + **número** registrado | Hadrian | App → WhatsApp → API Setup | D3 | número aparece com um "Phone number ID" |
| D5 | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | Hadrian | App → WhatsApp → API Setup | D4 | ids copiados |
| D6 | **Permanent access token** (System User com `whatsapp_business_messaging` + `whatsapp_business_management`) → `WHATSAPP_ACCESS_TOKEN` | Hadrian | Business Settings → System Users → Generate token | D2 | token não expira |
| D7 | `WHATSAPP_APP_SECRET` | Hadrian | App → Settings → Basic → App Secret | D3 | copiado |
| D8 | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` = string aleatória sua | Hadrian | você inventa | — | definido no env |
| D9 | Webhook configurado: callback `https://<domínio>/api/webhooks/whatsapp`, verify token = D8, campo **`messages`** assinado | Hadrian | App → WhatsApp → Configuration → Webhook | H, staging deployado, D8 | Meta mostra "Verified" e o campo `messages` marcado |
| D10 | **Templates** aprovados (pt-BR/en/es) para `appointment_confirmation`, `appointment_reminder`, `appointment_canceled`, `appointment_rescheduled`, `payment_link` | Hadrian | App → WhatsApp → Message Templates | D4 | status "Approved" |
| D11 | Teste real | Hadrian | agendar para um cliente com `whatsapp` + consentimento `WHATSAPP` concedido | J, K | `/messages` mostra `SENT → DELIVERED → READ` |

Sem as chaves: envio WhatsApp fica `FAILED` com backoff real e o fluxo cai para e-mail. Nunca simulado.

---

## E. Anthropic (chatbot)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| E1 | Código: Messages API via `fetch` (sem SDK), tools hard-scoped, handoff, sem tool que exceda o usuário | Claude | `src/features/chatbot/` | — | `RUN_DB_TESTS=1 npx vitest run tests/integration/chatbot.int.test.ts` |
| E2 | `ANTHROPIC_API_KEY` (`sk-ant-…`) | Hadrian | console.anthropic.com → API Keys | A5 | key criada |
| E3 | `CHATBOT_MODEL` (default `claude-sonnet-5`) | Claude | `env.ts` default | — | — |
| E4 | Cada barbearia liga o bot em **Configurações → Chatbot** | Hadrian (owner) | UI da barbearia | J | conversa responde com dados de tool, não inventados |

Sem a key: toda mensagem do chat cai na fila humana (`PENDING_HUMAN`) — nunca uma resposta falsa.

---

## F. Azure

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| F1 | `infra/main.bicep` — Log Analytics, ACR, PG Flexible 16, Redis, Blob, Key Vault, CAE, web, worker, `cron-reminders`, `cron-retry`, `migrate` | Claude | `infra/main.bicep` | — | `az bicep build --file infra/main.bicep` sem erro |
| F1a | **Helper único** `scripts/azure/provision-staging.sh` — RG → 1ª passada (materializa ACR/PG/Redis/Blob/KV/CAE/apps com imagem pública) → `az acr build` → 2ª passada com a imagem real. Idempotente, sem secret. | Claude | `npm run provision:staging` (após `az login` + exports do cabeçalho do script) | F1 | script termina com `staging infra provisioned` + imprime outputs |
| F2 | Resource group por ambiente | Hadrian | `az group create -n barber-staging -l brazilsouth` (o helper F1a já faz) | A1 | `az group show -n barber-staging` |
| F3 | Build da imagem única | Hadrian | `az acr build -r <acr> -t barber-saas:$(git rev-parse --short HEAD) --file Dockerfile .` (o helper F1a já faz) | F2 (ACR criado na 1ª passada) | imagem no ACR (`az acr repository show-tags`) |
| F4 | `az deployment group create` — `-p namePrefix=barber environment=staging image=<acr>/barber-saas:<tag> pgAdminLogin=barberadmin pgAdminPassword='<gerado, fora do chat>' appUrl=https://staging.<domínio>` | Hadrian | terminal (o helper F1a já faz as 2 passadas) | F2, F3 | `az deployment group show -n main` = `Succeeded`; outputs `webFqdn` / `keyVaultName` |
| F5 | PostgreSQL alcançável | Hadrian | `npm run preflight` (com `DATABASE_URL` de staging) | F4 | `✓ PostgreSQL connected` |
| F6 | Redis alcançável (`rediss://`) | Hadrian | `npm run preflight` | F4 | `✓ Redis PING → PONG` |
| F7 | Storage + container `uploads` | Hadrian | `npm run preflight` | F4 | `✓ Azure Blob container reachable` |
| F8 | Container App **web** rodando, ingress bound | Hadrian | `az containerapp show -n barber-staging-web` | F4 | `provisioningState` = `Succeeded`, tem FQDN |
| F9 | Container App **worker** rodando | Hadrian | `az containerapp show -n barber-staging-worker` | F4 | replicas ≥ 1; logs mostram "worker started" |
| F10 | Jobs `cron-reminders` (`*/15`) e `cron-retry` (`*/5`) agendados | Hadrian | `az containerapp job list` | F4 | ambos listados, `triggerType` = `Schedule` |
| F11 | Job `migrate` existe (manual) | Hadrian | `az containerapp job show -n barber-staging-migrate` | F4 | `triggerType` = `Manual` |
| F12 | Log Analytics recebendo logs | Hadrian | Portal → `barber-staging-logs` → Logs → `ContainerAppConsoleLogs_CL` | F8 | linhas recentes com `requestId` |

---

## G. GitHub Actions (CI/CD)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| G1 | `ci.yml` — install → prisma → typecheck → lint → test (RUN_DB_TESTS) → build → playwright smoke | Claude | `.github/workflows/ci.yml` | — | Actions verde no último push |
| G2 | `deploy.yml` — acr build → job `migrate` (aguarda) → roll web/worker/2 crons → smoke | Claude | `.github/workflows/deploy.yml` | — | workflow existe |
| G3 | Credencial federada OIDC (App Registration + federated credential no repo/environment) | Hadrian | Azure AD → App registrations → Federated credentials | A6 | `az login --service-principal --federated-token` (via Actions) funciona |
| G4 | Repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `APP_HEALTH_URL` | Hadrian | repo → Settings → Secrets and variables → Actions | G3 | secrets listados (produção no Environment) |
| G5 | Nenhum secret real no YAML | Claude | `git grep -nE "sk_(test|live)_|whsec_|re_[0-9A-Za-z]{10}" .github/` = vazio | — | grep vazio |
| G6 | Environment `production` com required reviewers | Hadrian | repo → Settings → Environments → production | A6 | reviewers configurados |

---

## H. Domínio

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| H1 | Documentação de DNS/HTTPS/URLs | Claude | `docs/deployment/domain.md` | — | — |
| H2 | Domínio custom no Container App web (`staging.<domínio>` e `app.<domínio>`) | Hadrian | `az containerapp hostname add` + validação CNAME/TXT | A7, F8 | hostname "Verified" |
| H3 | Certificado gerenciado (HTTPS) bound | Hadrian | `az containerapp hostname bind --certificate managed` | H2 | `https://…` abre sem aviso |
| H4 | `appUrl` no Bicep atualizado para o `https://` final + redeploy | Hadrian | `az deployment group create … appUrl=https://…` | H3 | `APP_URL` da app = URL final (aparece em links de e-mail/booking) |
| H5 | HSTS presente em produção | Claude/Hadrian | `curl -sI https://<domínio> \| grep -i strict-transport` | H3 | header `Strict-Transport-Security` presente |
| H6 | CSP não bloqueia Stripe/Anthropic/Meta | Claude | `next.config.ts` | — | Checkout Stripe abre; chatbot responde |

---

## I. Secrets (Key Vault)

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| I1 | 16 slots de secret declarados no Bicep + env wiring | Claude | `infra/main.bicep` (`appSecrets` / `appEnv`) | — | `grep -c "name: '" ` bate com 16 |
| I2 | Identidade de cada Container App/Job com role **Key Vault Secrets User** | Hadrian | `az role assignment create --role "Key Vault Secrets User" --assignee <principalId> --scope <kv-id>` | F4 | `az role assignment list --scope <kv-id>` |
| I3 | Valores dos secrets no Key Vault | Hadrian | `npm run keyvault:push -- --vault barber-stg-kv-xxxx --file .env.staging` (arquivo LOCAL, git-ignored) | I2, todas as chaves obtidas | `az keyvault secret list --vault-name <kv> --query "[].name"` lista os 13 setáveis |
| I4 | `secrets[]` do Bicep trocado de `value: ''` para `keyVaultUrl` + `identity: 'system'` + redeploy | Hadrian | editar `infra/main.bicep` + `az deployment group create` | I2, I3 | app sobe; `npm run check:env` (dentro de um `az containerapp exec`) mostra as integrações `configured` |
| I5 | `database-url` / `redis-url` / `azure-storage-connection-string` derivados pelo Bicep — **não** setar manualmente | Claude | `infra/main.bicep` | — | — |
| I6 | Nenhum secret no Git / imagem / logs | Claude | `.gitignore` (`.env.*`), `.dockerignore` (`.env*`), pino redaction, `logFinancialEvent` allowlist | — | `git grep` de padrões de secret = vazio |

---

## J. Staging — provisionar + migrar + seed

| # | Item | Resp. | Onde / comando | Dependência | Validar |
|---|---|---|---|---|---|
| J1 | Deploy de infra (F1–F4) | Hadrian | — | F | `az deployment group show` Succeeded |
| J2 | Key Vault populado (I) | Hadrian | — | I | `check:env` OK |
| J3 | Rodar o job de migração | Hadrian | `az containerapp job start -g barber-staging -n barber-staging-migrate` | J1 | execução "Succeeded"; logs "migrations applied" |
| J4 | `prisma migrate status` limpo | Hadrian | `DATABASE_URL=<staging> npx prisma migrate status` | J3 | "Database schema is up to date!" |
| J5 | Seed (uma vez) — 3 planos + super admin | Hadrian | `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD='…' DATABASE_URL=<staging> npm run db:seed` | J3 | `SELECT count(*) FROM "Plan"` = 3; login em `/admin` funciona |
| J6 | `stripe:sync-plans` (B8) | Hadrian | `STRIPE_SECRET_KEY=sk_test_… npm run stripe:sync-plans` | J5, B3 | `Plan.stripePriceId` preenchido |
| J7 | Webhooks (B4, B5, D9) apontando para o domínio de staging | Hadrian | dashboards Stripe / Meta | H2 | endpoints "Verified" |
| J8 | Deploy da aplicação | Hadrian | push no `main` (auto) **ou** `az containerapp update … --image` | J1–J7 | `deploy.yml` verde |
| J9 | Smoke | Hadrian | `npm run smoke -- https://staging.<domínio>` | J8 | todos ✓ |

---

## K. Testes (staging, Stripe Test Mode)

| # | Fluxo | Resp. | Como | Validar |
|---|---|---|---|---|
| K1 | Suíte automatizada | Hadrian | `RUN_DB_TESTS=1 npm test` (contra um DB descartável) | 186 verdes |
| K2 | Signup → verify → onboarding → plano → Checkout `4242…` | Hadrian | UI | webhook → `Subscription` ACTIVE; `/billing` mostra ativo; `Payment`+`Invoice` |
| K3 | Trial | Hadrian | escolher plano sem pagar (ou `trialDays`>0) | `Subscription` TRIALING, dashboard usável |
| K4 | Upgrade / downgrade | Hadrian | `/billing` → trocar plano | `subscriptions.update` (sem 2ª assinatura); webhook re-sincroniza |
| K5 | Pagamento falho | Hadrian | Stripe → "Update to past due" ou `stripe trigger invoice.payment_failed` | `PAST_DUE` + grace 7d; após grace, escrita bloqueada |
| K6 | Cancelamento | Hadrian | portal cancel ou `customer.subscription.deleted` | CANCELED, tenant bloqueado (leitura ok) |
| K7 | Webhook duplicado | Hadrian | reenviar um evento no Dashboard | `200 {duplicate:true}`, sem 2ª linha |
| K8 | Connect onboarding | Hadrian (owner) | `/payments` → conectar → onboarding de teste | status `ENABLED`, `chargesEnabled` true |
| K9 | Payment link | Hadrian | `/payments` → criar link → pagar `4242…` | `Payment(CLIENT_PAYMENT)` com `platformFeeCents`/`netCents` |
| K10 | Booking público + pagamento | Hadrian | página pública → serviço → barbeiro → horário → dados → pagar | appointment PENDING → webhook → CONFIRMED; `Payment` ligado; página do token = pago |
| K11 | Refund | Hadrian | `/payments` → refund | `charge.refunded` → linha `REFUNDED` |
| K12 | Cartão recusado | Hadrian | pagar com `4000 0000 0000 0002` | `payment_intent.payment_failed` → `Payment` FAILED + `failureCode` |
| K13 | Comunicação | Hadrian | completar um booking | e-mail de confirmação (real se Resend setado); WhatsApp se opt-in + configurado |
| K14 | Chatbot | Hadrian | widget na página pública → preço/horário → agendar | respostas com tool, `source = CHATBOT`, confirmação enviada |
| K15 | Cross-tenant | Claude | `RUN_DB_TESTS=1 npx vitest run tests/integration/tenant-isolation.int.test.ts` | 10 verdes |
| K16 | Golden path (camada de serviço) | Claude | `RUN_DB_TESTS=1 npx vitest run tests/integration/golden-path.int.test.ts` | 1 verde |

Cartões de teste: <https://stripe.com/docs/testing>.

---

## L. Production

| # | Item | Resp. | Como | Validar |
|---|---|---|---|---|
| L1 | Repetir F–J para `environment=prod`, RG `barber-prod`, `app.<domínio>` | Hadrian | mesmos comandos com `environment=prod` | `az deployment group show` Succeeded |
| L2 | **Ainda `sk_test_…`** — não trocar para live agora | Hadrian | Key Vault de prod com chaves de teste | `check:env` → `Stripe mode: test` |
| L3 | Environment `production` no GitHub com revisores | Hadrian | repo → Settings → Environments | G6 |
| L4 | Deploy prod | Hadrian | Actions → Deploy → Run workflow → environment: production → aprovar | `deploy.yml` verde; job `migrate` Succeeded |
| L5 | Smoke prod (com chaves de teste) | Hadrian | `npm run smoke -- https://app.<domínio>` | todos ✓ |
| L6 | Subconjunto do K contra prod-com-test-keys | Hadrian | K2, K10, K14 | OK |

---

## M. Stripe Live Mode

| # | Item | Resp. | Como | Validar |
|---|---|---|---|---|
| M1 | Ativação live completa (dados da empresa, conta bancária, impostos) | Hadrian | Stripe → desligar Test mode → completar ativação | conta "Active" em live |
| M2 | Criar os **dois webhooks live** (plataforma + Connect) nas URLs de prod | Hadrian | Stripe (live) → Developers → Webhooks | endpoints criados, `whsec_…` live copiados |
| M3 | Customer portal (live) habilitado | Hadrian | Stripe (live) → Settings → Billing → Customer portal | ativo |
| M4 | Connect (live): perfil, branding, statement descriptor | Hadrian | Stripe (live) → Connect → Settings | salvo |
| M5 | Chaves live no Key Vault de prod (`sk_live_…`, `pk_live_…`, 2× `whsec_…` live) + redeploy | Hadrian | `npm run keyvault:push -- --vault barber-prd-kv-… --file .env.production` + redeploy | `check:env` → `Stripe mode: LIVE ⚠` |
| M6 | `npm run stripe:sync-plans -- --allow-live` (cria Products/Prices live) | Hadrian | terminal com `STRIPE_SECRET_KEY=sk_live_…` | `Plan.stripePriceId` (live) preenchido |
| M7 | (opcional, imposto internacional) Stripe → Tax → registrations → `STRIPE_TAX_ENABLED=true` na app prod + redeploy | Hadrian | Stripe → Tax | Checkout coleta endereço + `tax_id` |
| M8 | Uma compra real de ponta a ponta com um cartão seu, depois **refund** | Hadrian | UI de prod | `Subscription` ACTIVE → refund → `REFUNDED` |

---

## N. Pós-lançamento

| # | Item | Resp. | Como | Validar |
|---|---|---|---|---|
| N1 | Monitoramento: alertas de erro / health no Azure Monitor + Sentry (se configurado) | Hadrian | Portal → Monitor → Alerts | alerta dispara num teste |
| N2 | Backup PostgreSQL confirmado (retenção, PITR) | Hadrian | Portal → PG server → Backup and restore | ponto de restauração listado |
| N3 | Runbook de recuperação testado (restore para um servidor novo) | Hadrian | `deployment/backup-recovery.md` | restore conclui |
| N4 | Rotação de secrets planejada (Stripe, tokens WhatsApp, `AUTH_SECRET`) | Hadrian | calendário / `deployment/keyvault.md` | processo documentado |
| N5 | Revisão de custos (recursos cobrados, custo variável) | Hadrian | `AZURE-COST-CHECKLIST.md` + Cost Management | orçamento + alerta de budget criados |
| N6 | `cron-reminders` e `cron-retry` executando de fato | Hadrian | `az containerapp job execution list` | execuções recentes "Succeeded" |
| N7 | Hardening de rede (VNet PG/Redis, private endpoints, Front Door/WAF) — **antes de escala real** | Hadrian | `infra/README.md` "Hardening TODO" | planejado/agendado |
| N8 | Playbook de incidente + status page (opcional) | Hadrian | — | existe |

---

## Estado alvo por fase

| Fase concluída | Estado |
|---|---|
| A–I documentados + scripts + Bicep + CI/CD (feito no repo) | `READY FOR CONFIGURATION` |
| A–J executados, staging no ar, smoke ✓ | `READY FOR STAGING` |
| K executado em staging + L (prod com test keys) + M8 (uma compra real ref\.) | `READY FOR PRODUCTION` |
