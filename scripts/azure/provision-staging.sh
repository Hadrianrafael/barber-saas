#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Provision the STAGING environment from infra/main.bicep.
#
# This is the ONLY script that talks to Azure. It is:
#   - idempotent      : re-running it converges, never duplicates
#   - non-destructive  : only `group create` / `acr build` / `deployment create`
#   - secret-free      : no secret value is passed, printed, or logged here.
#                        The Bicep declares every secret slot EMPTY; you fill
#                        them in Key Vault afterwards (scripts/keyvault-push.ts).
#
# PREREQUISITES (you do these — they need your identity):
#   1. az CLI installed            → https://aka.ms/azure-cli
#   2. az login                    → interactive, opens a browser
#   3. az account set --subscription "<your-subscription-id-or-name>"
#   4. export these in YOUR shell (values NEVER go in a file or in chat):
#        export RG=barber-staging
#        export LOCATION=brazilsouth
#        export APP_URL=https://staging.<your-domain>
#        export PG_ADMIN_LOGIN=barberadmin
#        export PG_ADMIN_PASSWORD='<generate: openssl rand -base64 24>'
#   5. run:  bash scripts/azure/provision-staging.sh
#
# After it finishes it prints the outputs (Key Vault name, web FQDN, …) and the
# exact next commands (Key Vault grants + secret push + migrate job + seed).
# ---------------------------------------------------------------------------
set -euo pipefail

BICEP="infra/main.bicep"
ENVIRONMENT="staging"
NAME_PREFIX="${NAME_PREFIX:-barber}"
BOOTSTRAP_IMAGE="mcr.microsoft.com/k8se/quickstart:latest"  # public; only used for the first pass
# Hard-pin the target subscription so nothing can be provisioned into the wrong one.
SUBSCRIPTION="${SUBSCRIPTION:-2dca76e6-18b9-4b11-97a4-de56e775974b}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ '$1' not found — install it first."; exit 1; }; }
req()  { [ -n "${!1:-}" ] || { echo "✗ env var \$$1 is not set (see header of this script)."; exit 1; }; }

echo "== preflight =="
need az
[ -f "$BICEP" ] || { echo "✗ run this from the repo root ($BICEP not found)."; exit 1; }
az account show >/dev/null 2>&1 || { echo "✗ not logged in — run 'az login' first."; exit 1; }
az account set --subscription "$SUBSCRIPTION"
ACTIVE_SUB="$(az account show --query id -o tsv)"
[ "$ACTIVE_SUB" = "$SUBSCRIPTION" ] || { echo "✗ active subscription is $ACTIVE_SUB, expected $SUBSCRIPTION"; exit 1; }
req RG; req LOCATION; req APP_URL; req PG_ADMIN_LOGIN; req PG_ADMIN_PASSWORD
SUB="$(az account show --query '[name, id]' -o tsv | tr '\t' ' ')"
echo "  subscription : $SUB"
echo "  resource grp : $RG   (region: $LOCATION)"
echo "  app url      : $APP_URL"
echo "  bicep        : $BICEP  (environment=$ENVIRONMENT)"
echo

echo "== 1/4  resource group (idempotent) =="
az group create -n "$RG" -l "$LOCATION" -o none
echo "  ok"
echo

echo "== 2/4  first pass — materialise infra (ACR, PG, Redis, Blob, Key Vault, CAE, apps) =="
echo "  Using a public bootstrap image for this pass; the real image is built next."
echo "  The web revision will be briefly Unhealthy and the worker/jobs will crashloop"
echo "  until pass 4 — this is expected."
az deployment group create -g "$RG" -f "$BICEP" \
  -p namePrefix="$NAME_PREFIX" environment="$ENVIRONMENT" \
     image="$BOOTSTRAP_IMAGE" \
     pgAdminLogin="$PG_ADMIN_LOGIN" pgAdminPassword="$PG_ADMIN_PASSWORD" \
     appUrl="$APP_URL" \
  -o none
ACR_LOGIN_SERVER="$(az deployment group show -g "$RG" -n main --query properties.outputs.acrLoginServer.value -o tsv)"
ACR_NAME="${ACR_LOGIN_SERVER%%.*}"
echo "  ACR ready: $ACR_LOGIN_SERVER"
echo

echo "== 3/4  build the real image in ACR (one image → web + worker + jobs) =="
TAG="$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
az acr build --registry "$ACR_NAME" \
  --image "barber-saas:${TAG}" --image "barber-saas:latest" \
  --file Dockerfile .
IMAGE="${ACR_LOGIN_SERVER}/barber-saas:${TAG}"
echo "  built: $IMAGE"
echo

echo "== 4/4  second pass — deploy the real image =="
az deployment group create -g "$RG" -f "$BICEP" \
  -p namePrefix="$NAME_PREFIX" environment="$ENVIRONMENT" \
     image="$IMAGE" \
     pgAdminLogin="$PG_ADMIN_LOGIN" pgAdminPassword="$PG_ADMIN_PASSWORD" \
     appUrl="$APP_URL" \
  -o none
echo "  deployed"
echo

echo "== outputs =="
az deployment group show -g "$RG" -n main --query properties.outputs -o json \
  | sed 's/^/  /'
KV_NAME="$(az deployment group show -g "$RG" -n main --query properties.outputs.keyVaultName.value -o tsv)"
WEB_FQDN="$(az deployment group show -g "$RG" -n main --query properties.outputs.webFqdn.value -o tsv)"

cat <<EOF

== NEXT (these need secret values — do them in YOUR shell, nothing in chat) ==

1) Grant every app/job identity read access to Key Vault:
     KV_ID=\$(az keyvault show -n $KV_NAME --query id -o tsv)
     for app in web worker; do
       PID=\$(az containerapp show -n ${NAME_PREFIX}-staging-\$app -g $RG --query identity.principalId -o tsv)
       az role assignment create --assignee-object-id "\$PID" --assignee-principal-type ServicePrincipal \\
         --role "Key Vault Secrets User" --scope "\$KV_ID"
     done
     for job in cron-reminders cron-retry migrate; do
       PID=\$(az containerapp job show -n ${NAME_PREFIX}-staging-\$job -g $RG --query identity.principalId -o tsv)
       az role assignment create --assignee-object-id "\$PID" --assignee-principal-type ServicePrincipal \\
         --role "Key Vault Secrets User" --scope "\$KV_ID"
     done

2) Put secret VALUES in Key Vault (fill .env.staging locally first — it is git-ignored):
     cp .env.staging.example .env.staging   # then edit values
     npm run keyvault:push -- --vault $KV_NAME --file .env.staging --dry-run
     npm run keyvault:push -- --vault $KV_NAME --file .env.staging

3) Point infra/main.bicep secrets[] at Key Vault (value:'' -> keyVaultUrl + identity:'system'),
   then re-run passes 3-4 of this deploy (or just: az deployment group create ... with the same image).

4) Run migrations + seed the plans and the platform admin:
     az containerapp job start -g $RG -n ${NAME_PREFIX}-staging-migrate
     # against the staging DB, from a shell that can reach it:
     SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed
     STRIPE_SECRET_KEY=sk_test_... npm run stripe:sync-plans

5) Smoke test:
     npm run smoke -- https://$WEB_FQDN
     # (temporary URL until you bind a custom domain — see docs/deployment/domain.md)

EOF
echo "staging infra provisioned. State: infra up, secrets NOT yet wired."
