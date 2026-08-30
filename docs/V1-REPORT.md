# V1 Comercial — Relatório consolidado

**Estado:** `READY FOR CONFIGURATION` — todo o código está implementado, testado
e com build de produção verde. Falta apenas fornecer as credenciais das
integrações externas (Stripe, Stripe Connect, WhatsApp, Anthropic, Resend, Azure
Blob) e executar o deploy. Nenhuma integração é simulada: sem chave, a
funcionalidade degrada de forma limpa (e-mail vai para o console, pagamentos
ficam desabilitados, o chat cai na fila humana), nunca finge sucesso.

Data: 2026-09-06 · Branch: `main` · 12 commits · 12 migrations · 12 ADRs ·
166 testes verdes.

---

## 1. Funcionalidades implementadas

| Área | Entregue |
|---|---|
| **Auth / multi-tenant / RBAC** | Cadastro, verificação de e-mail, login/logout, reset de senha, sessões opacas (hash SHA-256, cache Redis, revogáveis), dois realms de cookie (app + super admin). RBAC como dados (`OWNER > MANAGER > BARBER` + `PLATFORM_ADMIN`), `requireTenantContext({permission})`. Isolamento por `tenantId` + extensão `forTenant()`. |
| **Onboarding + configurações** | Wizard de 3 passos (identidade → contato/página → horários) com validação de slug no servidor, URL pública estável `/barber/{slug}`. Área de configurações (perfil, marca/upload, região, horários, feriados, config de agendamento, chatbot, fidelidade) com RBAC. País/moeda/timezone/locale por barbearia. |
| **Time · Serviços · Agenda** | CRUD de barbeiros (horário por barbeiro, folga/férias/bloqueios, comissão % ou fixa, desativação preserva histórico). CRUD de serviços com **snapshot de preço/duração/buffer no agendamento**. Agenda dia/semana/mês com filtros. Ciclo completo `PENDING→CONFIRMED→IN_PROGRESS→COMPLETED` + `CANCELED`/`NO_SHOW`. **Domínio de agendamento reutilizável** (`getAvailableSlots`, `createAppointment`, `reschedule/cancel/confirm/start/complete/noShow`) usado por dashboard, página pública e chatbot. **Prevenção de conflito** em 3 camadas: checagem de disponibilidade + transação `SERIALIZABLE` + constraint de exclusão GiST `appointment_no_overlap` (testado com concorrência). Instantes em `timestamptz`, render no timezone da barbearia. |
| **Clientes (CRM)** | CRUD + detecção de duplicados, segmentação reutilizável (`segmentWhere`), busca/filtro/paginação, histórico, consentimento por canal (opt-in/opt-out), apagamento GDPR (`anonymizedAt` mantém histórico), rollup de estatísticas ao concluir atendimento. |
| **Billing SaaS (Stripe)** | Planos como dados (`Plan.limits` JSON + `stripeProductId`/`stripePriceId`/`stripePriceIdYearly`, mensal/anual), `/pricing` + `/billing`, Stripe Checkout, **upgrade/downgrade in-place** (`subscriptions.update` prorrateado — sem segunda assinatura), Customer Portal, webhook idempotente `/api/webhooks/stripe` (`WebhookEvent` de-dup + `invoice.paid` idempotente por invoice), eventos `checkout.session.completed` / `customer.subscription.created|updated|resumed|deleted` / `invoice.created|finalized|paid|payment_succeeded|payment_failed` / `charge.refunded`, ciclo `trial → active → past_due+grace(7d) → canceled`, ledger `Payment`+`Invoice` (`scope=PLATFORM`), **gating de plano no servidor** (`assertWithinLimit`/`assertFeature`). `npm run stripe:sync-plans` cria Products/Prices em Test Mode (live só com `--allow-live`) e grava os IDs de volta. **Stripe Tax** opt-in (`STRIPE_TAX_ENABLED` → `automatic_tax` + cobrança de endereço/`tax_id` no Checkout). ADR 0013, `docs/STRIPE.md`. |
| **Stripe Connect (pagamento do cliente)** | Onboarding Express + mapeamento de status (`mapAccountStatus`, conta só usável com `chargesEnabled`), links de pagamento (Checkout na conta conectada + application fee `PLATFORM_FEE_BPS` + `invoice_creation` opcional), ledger com `platformFeeCents`/`netCents`, refunds (UI + webhook `charge.refunded`), webhook Connect separado `/api/webhooks/stripe/connect` (segredo próprio, `provider` próprio) que **verifica `event.account` contra a conta conectada do tenant** e descarta IDs de `appointment`/`customer` de outro tenant vindos no metadata; `payment_intent.payment_failed` marca `Payment` FAILED. 100% isolado do billing SaaS. Idempotency keys em `accounts.create` / `checkout.sessions.create` / `refunds.create`. Logs financeiros estruturados (`logFinancialEvent`, allowlist de campos). |
| **Financeiro** | `/finance` — faturado / recebido (líquido de refunds) / pendente / refunds / ticket médio / taxas / comissões, a partir de linhas reais. Presets de período no tz da barbearia, comissões por barbeiro, gráfico 6 meses, log paginado, exportação CSV. |
| **Comunicação (e-mail + WhatsApp)** | Templates multilíngues (pt-BR/en/es, `{{var}}`, override por tenant, HTML no e-mail). Política de consentimento (`canContact` — WhatsApp/SMS exigem opt-in; e-mail transacional salvo opt-out). Dispatch persiste `Message` + retry com backoff `[1,5,30,120,360]`min. **Resend** (transporte console quando sem chave) + **WhatsApp Cloud API oficial** (`graph.facebook.com/v21.0`) — nunca simulado. `notifyAppointment`/`notifyPaymentLink` tentam WhatsApp→e-mail. Disparo assíncrono via BullMQ (nunca no request path). Crons `cron:reminders` + `cron:retry-messages`. Webhook WhatsApp assinado `/api/webhooks/whatsapp` (verificação GET + `x-hub-signature-256`, recibos de status + inbound). Página `/messages`. |
| **Página pública de agendamento** | `/barber/{slug}/book` em pt-BR/en/es: stepper serviço → barbeiro (ou "qualquer") → data → horário → dados → confirmar. Único consumidor público do domínio de agendamento — zero lógica de disponibilidade reimplementada. "Qualquer barbeiro" resolvido no servidor. Dedupe de cliente por email/telefone únicos por tenant, **sem opt-in automático**. Rate limit por IP. Pagamento online via `createPaymentLink` do Connect quando habilitado (agendamento fica PENDING primeiro, nunca perdido; webhook confirma PENDING→CONFIRMED). `Appointment.publicToken` (SHA-256) para confirmação e cancelar/remarcar online sem conta. Páginas `noindex`. |
| **Chatbot IA** | Anthropic Messages API via `fetch` (sem SDK), `CHATBOT_MODEL` default `claude-sonnet-5`, env-gated (sem chave → toda mensagem cai na fila humana, nunca resposta falsa). **Capacidades fixas no código, não um papel** — ~10 tools, cada uma hard-scoped ao `tenantId` da conversa e (para dados de cliente) ao único cliente vinculado via `identify_customer`; agendar/cancelar/remarcar reusam o domínio de agendamento; **não existe tool** para financeiro/equipe/config/outros clientes/campanhas/auditoria. Loop ≤6 tools, timeout 30s, cada passo persistido, degrada para handoff em erro. Widget de web-chat em `/barber/{slug}` (token de sessão hasheado, isolamento por thread). `detectLocale` pt/en/es. Painel `/conversations` (lista + filtros + thread com toggle de tool calls). "Assumir" (`conversation.handle`) → IA para; "Devolver para a IA". Config por tenant (persona/saudação/instruções/palavras-gatilho) só afina a voz. |
| **Importação** | Parser CSV sem dependência (aspas/vírgulas/CRLF/BOM). Upload → validação linha a linha (`ok`/`duplicate`/`error` + erros + contagens, persistido em `ContactImport`) → wizard de preview → confirmação cria `Customer(source=IMPORT)`, **nenhum consentimento é marcado**. Limites 2 MB / 5000 linhas, `.csv` + MIME. Re-confirmação recusada. XLSX = follow-up documentado. |
| **Campanhas** | `Campaign` + `Message(campaignId, category=marketing)`. Público via `segmentWhere` (todos/ativos/inativos/novos/recorrentes/por serviço/por barbeiro/opt-in). **Marketing exige opt-in explícito em todo canal** (inclusive e-mail) — filtrado na query de público e re-checado por destinatário no worker. `launchCampaign` só enfileira; **entrega roda no worker** (`deliverCampaign` — paginação por cursor, renderiza `{{nome}}`/`{{barbearia}}`/`{{barbeiro}}`/`{{ultimo_servico}}`/`{{link_agendamento}}`, reusa `sendMessage` para o retry cobrir falhas). |
| **Fidelidade** | Config em `Tenant.loyaltyConfig` (pontos/visita, centavos/ponto extra, expiração) + override `Service.loyaltyPoints`. `earnForCompletedAppointment` fire-and-forget na transição COMPLETED, idempotente (`@@unique([appointmentId, reason])`). Catálogo `LoyaltyReward` (desconto/serviço grátis/custom). `redeemReward` debita pontos + emite `Coupon` de uso único. `adjustPoints` para correção manual. Página `/loyalty` + aba de configuração. |
| **Avaliações** | Submissão pública em `/barber/{slug}/review/{token}` (reusa `publicToken`, só atendimento COMPLETED, uma por atendimento, criada não publicada). Link "Avaliar" na página de confirmação. Painel `/reviews` (`review.moderate`): média geral + por barbeiro **só sobre publicadas**, filtro pendente/publicada/todas, aprovar/ocultar. |
| **Super Admin** | `platformMetrics` (barbearias por status, ~MRR de assinaturas PLATFORM ativas, GMV de pagamentos de cliente + taxas, contagens de mensagens/campanhas). `/admin/tenants` (busca/filtro/paginação) + `/admin/tenants/[id]` (membros, assinatura, status Connect, pagamentos recentes, uso de mensagens 30d) + `/admin/audit` (AuditLog da plataforma + filtro). **Impersonação segura**: ação gated por sessão admin → sessão de app **não-admin** para o próprio usuário admin com `impersonatedTenantId` (poder OWNER só naquele tenant), sempre auditada; banner âmbar persistente + Exit no app; cookie admin intocado. |

---

## 2. Arquitetura final

- **Next.js 15.5** App Router, TypeScript strict, React 19. Dois roots:
  `src/app/(site)/[locale]/…` (app localizado + páginas públicas) e
  `src/app/(admin)/admin/…` (realm Super Admin — `<html>` próprio, cookie
  próprio, layout próprio).
- **Multi-tenancy**: schema compartilhado, `tenantId` em toda tabela de tenant,
  `forTenant(tenantId)` (`$extends` do Prisma) auto-escopa leituras/escritas,
  `requireTenantContext({ permission })` é o único ponto de entrada de toda
  server action / route handler com escopo de tenant.
- **Domínio de agendamento** (`src/features/scheduling/`): puro e reutilizável —
  `time.ts` (DST-aware via `@date-fns/tz`), `slots.ts`, `availability.ts`,
  `appointments.ts`. Todo caminho de escrita (dashboard, público, chatbot) passa
  por ele; regras de negócio nunca vivem na UI.
- **Abstração de pagamentos** (`src/server/payments/`): `PaymentProvider` +
  `stripe-provider` + singleton `paymentProvider`. Dois fluxos de dinheiro
  totalmente isolados: assinatura SaaS (conta plataforma) × cliente→barbearia
  (contas Connect Express), webhooks e segredos separados,
  `Payment.purpose` / `WebhookEvent.provider` distintos.
- **Messaging** (`src/features/messaging/`): `templates` → `consent` → `channels`
  (Resend / WhatsApp Cloud API) → `dispatch` (persiste + tenta + retry) →
  `notify` (fallback de canal). Campanhas reusam `sendMessage`.
- **Worker** (`src/worker/`): filas BullMQ `notifications` / `messages` /
  `campaign` / `webhooks`; processadores; crons `reminders` e `retry-messages`.
  Nada que dispare mensagem roda no request path.
- **Feature-scoped**: `src/features/<domínio>/` agrupa UI + server actions +
  schema + serviço. `src/server/` (db, auth, rbac, mail, storage, payments) é
  agnóstico de framework.
- **i18n**: `next-intl`, `localePrefix: "always"`, mensagens em
  `messages/{pt-BR,en,es}.json`. Nenhum texto de usuário hardcoded nos
  componentes do app/tenant e páginas públicas. O realm `/admin` é pt-BR
  estático por decisão (ferramenta interna).

---

## 3. Banco / schema

PostgreSQL 16 + Prisma. 12 migrations. Detalhes em
[docs/deployment/database.md](deployment/database.md). Pontos-chave:

- Dinheiro = inteiro em centavos + coluna `currency`. Serviço faz **snapshot** de
  preço/duração/buffer no `Appointment`; `Payment` faz snapshot de
  valor/taxa/líquido. Edições no catálogo nunca reescrevem histórico.
- `Appointment.startsAt/endsAt` em `timestamptz`. Constraint de exclusão
  `btree_gist` `appointment_no_overlap` torna overbooking impossível no nível do
  banco.
- Soft-delete/histórico: `Customer.anonymizedAt` (GDPR mantém histórico), enums
  de `status`; remover barbeiro/serviço **desativa** (FK de `Service` em
  `Appointment` é `Restrict`).
- Idempotência: `WebhookEvent @@unique([provider, eventId])`,
  `Message @@unique([provider, providerMessageId])`,
  `LoyaltyTransaction @@unique([appointmentId, reason])`,
  `Review @@unique(appointmentId)`.
- Config como dados: `Plan.limits`, `Tenant.bookingConfig` / `chatbotConfig` /
  `loyaltyConfig` (JSON validado na camada de app).
- Índices `@@index([tenantId, …])` em toda superfície de listagem; paginação em
  todas as listas.

**Follow-ups de banco** (não bloqueiam launch): job de expiração de pontos de
fidelidade; cron de disparo de campanhas agendadas (`Campaign.scheduledAt`);
relação `Review.employee` (hoje resolvida por query auxiliar).

---

## 4. Integrações — o que falta configurar

Estado atual: **todas implementadas de verdade e env-gated**. Para ativar cada
uma, defina as variáveis abaixo (detalhe em
[docs/deployment/environment-variables.md](deployment/environment-variables.md))
e siga o doc indicado.

| Integração | Variáveis | Onde configurar | Como testar depois |
|---|---|---|---|
| **Stripe (assinatura SaaS)** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_TAX_ENABLED` (opcional) | Dashboard Stripe → API keys + Webhook `/api/webhooks/stripe` (lista de eventos em `docs/STRIPE.md`). Depois: `STRIPE_SECRET_KEY=sk_test_… npm run stripe:sync-plans`. `docs/STRIPE.md` | Assinar um plano em `/pricing` → Checkout → `/billing` mostra `active`, linhas em `Payment`/`Invoice`. `stripe trigger invoice.payment_failed` → PAST_DUE. |
| **Stripe Connect (pagamento do cliente)** | `STRIPE_CONNECT_WEBHOOK_SECRET`, `PLATFORM_FEE_BPS` (mesma `STRIPE_SECRET_KEY`; **`STRIPE_CONNECT_CLIENT_ID` não é usado**) | Stripe → Connect + Webhook separado `/api/webhooks/stripe/connect` ("Listen to events on Connected accounts"). `docs/STRIPE.md` | `/payments` → conectar conta Express → criar link → pagar com `4242…` → `Payment(purpose=CLIENT_PAYMENT)` com `platformFeeCents`/`netCents`; refund → `charge.refunded`. |
| **WhatsApp (Cloud API oficial)** | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Meta for Developers → WhatsApp → API Setup; webhook em `/api/webhooks/whatsapp` (campo `messages`), templates aprovados para mensagens fora da janela de 24h. `docs/deployment/whatsapp.md` | Agendar para um cliente com `whatsapp` + consentimento `WHATSAPP` concedido → acompanhar `/messages` (`SENT → DELIVERED → READ`). |
| **Anthropic (chatbot)** | `ANTHROPIC_API_KEY`, `CHATBOT_MODEL` (opcional) | console.anthropic.com → API Keys. Ativar o chatbot em Configurações → aba Chatbot. `docs/deployment/chatbot.md` | Abrir o widget em `/barber/{slug}`, pedir preços/horários → o bot deve chamar tools e responder com dados reais; testar "falar com atendente" → conversa vai para `PENDING_HUMAN`. |
| **Resend (e-mail)** | `RESEND_API_KEY`, `EMAIL_FROM` (domínio verificado) | resend.com → API Keys + DNS (SPF/DKIM). `docs/deployment/resend.md` | Criar um agendamento → e-mail de confirmação real (com chave) ou no console (sem chave); `/messages` mostra o status. |
| **Azure Blob (uploads)** | `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `STORAGE_PUBLIC_URL` | Storage account + container no Azure. | Fazer upload de logo/capa em Configurações → conferir que a URL aponta para o blob. |
| **Sentry (opcional)** | `SENTRY_DSN` | sentry.io | Forçar um erro e ver no painel. |

Variáveis **obrigatórias** (sem elas o processo não sobe): `DATABASE_URL`,
`DIRECT_DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (≥ 24 chars), `APP_URL`.

---

## 5. Azure — produção

IaC em `infra/main.bicep` (Log Analytics, ACR, Postgres Flexible Server, Redis,
Storage+Blob, Key Vault + managed identity, Container Apps env, app **web**, app
**worker**, job **reminders**). Ambientes `dev` / `staging` / `prod` pelo mesmo
template parametrizado por `environment`. Passo a passo em
[docs/deployment/azure.md](deployment/azure.md).

Comandos (web = `npm run start`; worker = `npm run worker:start`; jobs =
`npm run cron:reminders` / `npm run cron:retry-messages`). Adicionar os jobs
`retry-messages` (o template hoje cria só `reminders`) — comando no doc.

**Probes**: liveness `GET /api/health/live` (sem dependências), readiness
`GET /api/health` (Postgres obrigatório; Redis degrada mas segue pronto).

**Segredos**: Key Vault, referenciados pelos Container Apps como `secretRef`.
Nunca no Git, nunca na imagem. `.gitignore` cobre `.env*`, `*.pem`, `*.key`.

---

## 6. CI/CD

- **`.github/workflows/ci.yml`** (existente): em todo push/PR — `npm ci` →
  `prisma generate` → `prisma migrate deploy` → `typecheck` → `lint` → `test`
  (unit + integração com Postgres/Redis de serviço, `RUN_DB_TESTS=1`) →
  `build` → Playwright smoke.
- **`.github/workflows/deploy.yml`** (novo): `az acr build` →
  `prisma migrate deploy` (forward-only, uma vez, antes de qualquer app subir) →
  `az containerapp update --image` para web / worker / jobs → smoke de readiness
  contra `/api/health`. **Staging** deploya automático no `main` verde;
  **produção** é `workflow_dispatch` com o GitHub Environment `production`
  (revisores obrigatórios). Login Azure via OIDC federado. **Nenhum passo
  destrutivo** — rollback = redeploy de um SHA anterior.

Secrets do GitHub necessários: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `DATABASE_URL`,
`DIRECT_DATABASE_URL`, `APP_HEALTH_URL`.

---

## 7. Testes

- **166 testes verdes**, 29 arquivos. `vitest`, `fileParallelism: false`
  (banco `barber_test` compartilhado). Integração roda contra Postgres real
  quando `RUN_DB_TESTS=1` (CI define).
- **Unitários**: RBAC, tempo/slots/transições de agendamento, schemas
  (team/service/crm/booking/loyalty), segmentos CRM, comissão, plano/limites,
  regiões, slug, senha, templates de mensagem, config do chatbot + detecção de
  idioma, parser CSV + pontos de fidelidade.
- **Integração (DB)**: agendamento (tx serializable + constraint GiST +
  concorrência + isolamento cross-tenant), CRM (rollup + anonimização),
  billing (webhook + gating), Connect (status + checkout + refund),
  financeiro, messaging (transporte console, retry, consentimento, fallback de
  canal), **booking público** (fluxo, SLOT_TAKEN em concorrência, dedupe + opt-in,
  cancelar por token respeitando cutoff), **chatbot** (escopo por tenant, gate de
  identificação, só o próprio agendamento, cancelamento cross-customer recusado,
  handoff, IA desligada → fila humana, token inválido, take-over bloqueia a IA),
  **slice 11** (fidelidade idempotente + resgate/cupom, elegibilidade de review
  + moderação afeta a média, CSV parse/validate/confirm sem consentimento +
  re-confirm recusado, campanha respeita consentimento + entrega pelo worker).
- **Cobertura dos 5 fluxos críticos**: o caminho de servidor de todos os cinco
  está exercitado pela suíte de integração (real Postgres). **Pendência
  assumida**: E2E de browser Playwright dos 5 fluxos — `tests/e2e/smoke.spec.ts`
  roda no CI; o tempo de compilação do `next dev` na máquina atual inviabiliza
  E2E interativo lá (ver ADR 0012).

---

## 8. Segurança

Detalhe completo em [docs/SECURITY.md](SECURITY.md). Resumo do que foi revisado
e está ativo:

- **AuthZ**: RBAC no servidor em toda mutação; nunca confia em `tenantId`/role/
  claim do cliente; `forTenant()` em toda query de tenant.
- **Isolamento cross-tenant**: testado nas suítes de agendamento/CRM/chatbot com
  um segundo tenant presente.
- **Webhooks**: assinatura verificada antes de processar (Stripe
  `constructEvent`; WhatsApp HMAC-SHA256 `timingSafeEqual`); idempotência por
  `WebhookEvent` + guardas de estado; estado escrito só por webhook, nunca por
  redirect de sucesso.
- **IA nunca excede o usuário**: capacidades do chatbot fixas no código,
  hard-scoped a tenant + ao cliente da conversa; sem tool para
  financeiro/equipe/config/outros clientes/campanhas/auditoria.
- **Campanhas**: marketing exige opt-in explícito em todo canal.
- **Impersonação**: só sessão admin inicia; sessão não-admin para o próprio
  admin com `impersonatedTenantId`; sempre auditada; banner + Exit; cookie admin
  intocado.
- **Rate limiting** (Redis, fixed-window, fail-open): login (IP+email), signup,
  reset, resend, admin sign-in; booking (slots 60/min, submit 10/5min, manage
  20/5min); chat (start 20/5min, send 30/2min); review (10/5min).
- **Headers**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, **CSP baseline** (`frame-ancestors 'none'`,
  `object-src 'none'`, `form-action 'self'`, `connect-src` restrito),
  **HSTS** em produção.
- **Uploads**: imagens ≤ 4 MB + MIME allowlist; CSV ≤ 2 MB + `.csv`/MIME +
  ≤ 5000 linhas, parse in-process, validação por linha.
- **Dados**: sem dado de cartão (Stripe, postura SAQ-A); PII fora dos logs
  (redação pino); `AuditLog` para ações sensíveis.
- **Correlação**: `x-request-id` em toda request/response; `reqLog()` amarra os
  logs.

**Follow-ups de segurança rastreados** (não bloqueiam): CSP com nonce (remover
`script-src 'unsafe-inline'`); E2E de browser dos 5 fluxos; sweep exaustivo
automatizado de isolamento cross-tenant; revisão profunda OWASP Top 10.

---

## 9. Observabilidade

- Logs estruturados pino (JSON → stdout → Log Analytics), redação de
  secrets/PII.
- `x-request-id` de correlação em toda request (reaproveita valor de entrada do
  ingress Azure) espelhado na response e nos headers encaminhados;
  `src/lib/request-context.ts` (`getRequestId` / `reqLog`).
- Health split: `/api/health/live` (liveness) + `/api/health` (readiness:
  Postgres obrigatório, Redis degrada).
- Métricas de plataforma no `/admin` (barbearias por status, MRR aprox., GMV,
  taxas, mensagens, campanhas). Falhas de mensagem visíveis por tenant em
  `/admin/tenants/[id]`.

---

## 10. Pendências (conscientes, não-bloqueantes)

| Item | Onde está registrado |
|---|---|
| Importação XLSX (hoje só CSV) | ADR 0011 |
| Aplicação automática do cupom de fidelidade no checkout | ADR 0011 |
| Enforcement de expiração de pontos (campo existe) | ADR 0011 / database.md |
| Pickup de campanhas agendadas (`scheduledAt` existe) | ADR 0011 / database.md |
| Mensagem automática de "peça sua avaliação" pós-atendimento | ADR 0011 |
| Número de WhatsApp por tenant (hoje 1 número da plataforma) | ADR 0008 |
| WhatsApp inbound alimentando o agente do chatbot | ADR 0010 |
| CSP com nonce | ADR 0012 / SECURITY.md |
| E2E Playwright dos 5 fluxos | ADR 0012 / SECURITY.md |
| Relação `Review.employee` no schema | ADR 0011 / database.md |
| Adicionar job `retry-messages` ao Bicep | azure.md |

---

## 11. Credenciais necessárias (checklist de ativação)

- [ ] `DATABASE_URL` / `DIRECT_DATABASE_URL` (Postgres Flexible Server)
- [ ] `REDIS_URL` (Azure Cache for Redis)
- [ ] `AUTH_SECRET` (32+ chars aleatórios)
- [ ] `APP_URL` (domínio de produção)
- [ ] `RESEND_API_KEY` + `EMAIL_FROM` (domínio verificado)
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` + `STRIPE_WEBHOOK_SECRET`
- [ ] `STRIPE_CONNECT_WEBHOOK_SECRET` + `PLATFORM_FEE_BPS`
- [ ] `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_BUSINESS_ACCOUNT_ID` +
      `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_WEBHOOK_VERIFY_TOKEN` +
      `WHATSAPP_APP_SECRET`
- [ ] `ANTHROPIC_API_KEY` (+ ativar o chatbot em Configurações)
- [ ] `AZURE_STORAGE_CONNECTION_STRING` + `AZURE_STORAGE_CONTAINER` +
      `STORAGE_PUBLIC_URL`
- [ ] Secrets do GitHub para `deploy.yml` (seção 6)
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` para o seed do super admin

---

## 12. Comandos de deploy

```bash
# 1. Provisionar (por ambiente)
az group create -n barber-prod -l brazilsouth
az deployment group create -g barber-prod -f infra/main.bicep \
  -p namePrefix=barber environment=prod pgAdminLogin=barberadmin \
     pgAdminPassword='<gerar>' appUrl=https://app.exemplo.com \
     webImage=<acr>.azurecr.io/barber-saas:bootstrap \
     workerImage=<acr>.azurecr.io/barber-saas:bootstrap

# 2. Popular Key Vault (todos os secrets da seção 11)
az keyvault secret set --vault-name <kv> --name DATABASE-URL --value '...'
# ...

# 3. Migrations + seed (uma vez)
DATABASE_URL=... DIRECT_DATABASE_URL=... npx prisma migrate deploy
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npx tsx prisma/seed.ts

# 4. Deploy contínuo: push no main → staging automático;
#    produção → GitHub Actions → workflow "Deploy" → environment=production
```

---

## 13. Commits

| Hash | Slice |
|---|---|
| `116b91b` | Slice 0 + 1 — foundation, auth, multi-tenancy, RBAC, Super Admin |
| `70abbb2` | Slice 2 — onboarding + settings + scaffold da página pública |
| `c0b156f` | Slice 3 — team, serviços, agenda + domínio de agendamento reutilizável |
| `613b57e` | Slice 4 — Clients CRM |
| `6e6fdbc` | Slice 5 — billing de assinatura SaaS (Stripe) + gating de plano |
| `7e92b54` | Slice 6 — Stripe Connect: pagamento cliente → barbearia |
| `5caf51e` | Slice 7 — Financeiro |
| `3fd8355` | Slice 8 — Comunicação: e-mail (Resend) + WhatsApp (Meta Cloud API) |
| `2708edd` | Slice 9 — Booking público `/barber/{slug}/book` (pt-BR/en/es) |
| `d5d382b` | Slice 10 — Chatbot IA tool-grounded, por tenant, handoff humano |
| `2a6a3e0` | Slice 11 — Import · Campanhas · Fidelidade · Avaliações · Super Admin |
| `a6b257b` | Production hardening — observabilidade, headers, CI/CD deploy, docs |

| `4bfa2a2` | Stripe — finalização (Products/Prices como dados + `stripe:sync-plans`, upgrade/downgrade in-place, verificação de `event.account` no Connect, `subscription.resumed` + `charge.refunded` no SaaS, Stripe Tax opt-in, idempotency keys, logs financeiros estruturados). ADR 0013, `docs/STRIPE.md` |

ADRs: `docs/adr/0001`–`0013`.
