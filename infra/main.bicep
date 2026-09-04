// Barber SaaS — Azure infrastructure.
//
// One template, parameterised by `environment` (dev | staging | prod). Deploy it
// once per environment into its own resource group. Resources:
//   Log Analytics · ACR · Postgres Flexible Server · Azure Cache for Redis ·
//   Storage (Blob) · Key Vault · Container Apps env · web app · worker app ·
//   three scheduled jobs (reminders, retry-messages, sdr-dispatch).
//
// SECRETS: every external-integration secret (Stripe, Resend, Anthropic,
// WhatsApp, Sentry, OpenAI, external voice) is a Key Vault REFERENCE
// (`keyVaultUrl` + `identity`, see `kvSecretSlots`/`kvSecretsAccess` below) —
// this template only reads those slots, it never writes a value into them, so
// redeploying can never overwrite a real credential. Populate them with
// `az keyvault secret set` or `npm run keyvault:push` (see
// docs/deployment/keyvault.md); each slot must exist in the vault before the
// first deploy that references it. `database-url` / `direct-database-url` /
// `redis-url` / `auth-secret` / `azure-storage-connection-string` stay inline
// because they are derived from resources this template itself provisions.
// Nothing sensitive lives in this file, in Git, or in the image.

@description('Base name for all resources, e.g. "barber"')
param namePrefix string = 'barber'

@description('Azure region')
param location string = resourceGroup().location

@description('Environment: dev | staging | prod')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Container image (one image runs web + worker + jobs), e.g. <acr>.azurecr.io/barber-saas:<tag>')
param image string

@description('PostgreSQL administrator login')
param pgAdminLogin string

@secure()
@description('PostgreSQL administrator password')
param pgAdminPassword string

@description('Public base URL of the app for this environment, e.g. https://app.example.com')
param appUrl string

@secure()
@description('App session signing secret (48+ random bytes). Stable across deploys — pass the value already in use, not a freshly generated one.')
param authSecret string

var isProd = environment == 'prod'
var tags = {
  app: 'barber-saas'
  env: environment
}
var suffix = uniqueString(resourceGroup().id, namePrefix, environment)
var envPrefix = '${namePrefix}-${environment}'
// Short slug for resources with tight name-length limits (Storage ≤24, Key Vault ≤24).
var envSlug = environment == 'prod' ? 'prd' : (environment == 'staging' ? 'stg' : 'dev')

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${envPrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: isProd ? 90 : 30
  }
}

// ---------------------------------------------------------------------------
// Container registry (shared across environments is also fine — one per RG here)
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: '${namePrefix}acr${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

// One user-assigned identity shared by web + worker + jobs. Granting AcrPull to
// a standalone UAMI (instead of each app's system identity) breaks the
// create-time race: the role exists before any container tries to pull.
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${envPrefix}-id'
  location: location
  tags: tags
}

var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL Flexible Server
// ---------------------------------------------------------------------------
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${envPrefix}-pg-${suffix}'
  location: location
  tags: tags
  sku: {
    name: isProd ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    tier: isProd ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: isProd ? 64 : 32 }
    backup: {
      backupRetentionDays: isProd ? 21 : 7
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: isProd ? 'ZoneRedundant' : 'Disabled'
    }
  }

  resource db 'databases@2023-12-01-preview' = {
    name: 'barber'
  }

  // Allow Azure services (Container Apps). HARDENING TODO: put PG on a VNet and
  // delete this rule for prod (see infra/README.md).
  resource fwAzure 'firewallRules@2023-12-01-preview' = {
    name: 'AllowAzureServices'
    properties: {
      startIpAddress: '0.0.0.0'
      endIpAddress: '0.0.0.0'
    }
  }
}

// Azure PG Flexible Server blocks CREATE EXTENSION unless the extension is
// allow-listed here. Migration 20260830000100 needs btree_gist for the
// no-overlapping-appointments GiST exclusion constraint.
resource pgExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: pg
  name: 'azure.extensions'
  properties: {
    value: 'BTREE_GIST'
    source: 'user-override'
  }
}

// ---------------------------------------------------------------------------
// Redis — self-hosted as an internal Container App (STAGING decision).
// Classic Azure Cache for Redis is closed to new creates in this subscription
// and Azure Managed Redis is out of budget for staging. Scope: cache + BullMQ
// queue storage only. No persistence: a restart drops in-flight jobs (the
// cron-retry job re-drives messages) and caches simply repopulate.
// Reachable only inside the Container Apps environment (internal TCP ingress).
// ---------------------------------------------------------------------------
resource redisApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${envPrefix}-redis'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        transport: 'tcp'
        targetPort: 6379
        exposedPort: 6379
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'redis:7-alpine'
          command: ['redis-server', '--protected-mode', 'no', '--save', '', '--appendonly', 'no']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Storage (Blob) for uploads (logos, covers, photos, avatars)
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // Storage account names: 3–24 chars, lowercase alphanumeric only.
  name: '${namePrefix}${envSlug}st${take(suffix, 10)}'
  location: location
  tags: tags
  sku: { name: isProd ? 'Standard_ZRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    supportsHttpsTrafficOnly: true
  }

  resource blob 'blobServices@2023-05-01' = {
    name: 'default'
    resource uploads 'containers@2023-05-01' = {
      name: 'uploads'
      properties: { publicAccess: 'Blob' }
    }
  }
}

// ---------------------------------------------------------------------------
// Key Vault — populate secret VALUES out of band, then point `secrets[]` here
// ---------------------------------------------------------------------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  // Key Vault names: 3–24 chars, alphanumeric + hyphens, start with a letter.
  name: '${namePrefix}-${envSlug}-kv-${take(suffix, 8)}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: isProd ? 90 : 30
    // Azure rejects `false` here (purge protection is irreversible once on).
    // Pass `true` only for prod; omit entirely otherwise.
    enablePurgeProtection: isProd ? true : null
  }
}

// Integration secret slots that live IN Key Vault (go-live path). Bicep never
// creates or writes these — only builds the `<vault>/secrets/<name>` URL a
// Container App secret uses to read the CURRENT value at runtime — so a
// redeploy can never overwrite a real credential an operator has put in the
// vault. Each slot must exist in the vault before the first deploy that
// references it (see docs/deployment/keyvault.md); until then it's fine for
// it to hold the same single-space placeholder used for the inline slots.
var kvSecretSlots = [
  'stripe-secret-key'
  'stripe-publishable-key'
  'stripe-webhook-secret'
  'stripe-connect-webhook-secret'
  'resend-api-key'
  'anthropic-api-key'
  'whatsapp-phone-number-id'
  'whatsapp-business-account-id'
  'whatsapp-access-token'
  'whatsapp-webhook-verify-token'
  'whatsapp-app-secret'
  'sentry-dsn'
  'openai-api-key'
  'external-voice-base-url'
  'external-voice-api-key'
  'external-voice-id'
]

// Lets web/worker/jobs resolve `keyVaultUrl` secrets at runtime. Role id
// 4633458b-17de-408a-b874-0445c86b69e6 = built-in "Key Vault Secrets User"
// (read-only data-plane access — no write, no admin).
var kvSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
resource kvSecretsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uami.id, 'kv-secrets-user')
  scope: kv
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Container Apps environment
// ---------------------------------------------------------------------------
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${envPrefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Secrets + env wiring (shared by web / worker / jobs)
// ---------------------------------------------------------------------------
// Derived connection strings — these come straight from the provisioned
// resources, so they are real from day one.
// `dbDirectUrl` is the plain connection used by `prisma migrate deploy`
// (schema.prisma `directUrl`). `dbUrl` is the runtime pool — capped at 5
// connections so web + worker + a one-off job (seed) together stay well under
// the B1ms Burstable `max_connections` (~35); an uncapped pool sizes itself to
// the host CPU count and exhausts the server, which is what hung the seed.
var dbDirectUrl = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/barber?sslmode=require'
var dbUrl = '${dbDirectUrl}&connection_limit=5&pool_timeout=30'
// Internal-only, no auth, no TLS — isolated to the Container Apps env network.
// TCP ingress between apps in the same environment is reached by the plain app
// name (the `.internal.<defaultDomain>` FQDN form is HTTP-only and does not
// route TCP — it was the cause of the `connect ETIMEDOUT` from web/worker).
var redisUrl = 'redis://${envPrefix}-redis:6379'
// Azure public cloud suffix (brazilsouth). Change for sovereign/gov clouds.
var storageSuffix = 'core.windows.net'
var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${storageSuffix}'
var storagePublicUrl = '${storage.properties.primaryEndpoints.blob}uploads'

// database-url / direct-database-url / redis-url / auth-secret /
// azure-storage-connection-string are derived straight from resources this
// same template provisions (or the `authSecret` deploy param) — they stay
// inline; there is no external credential to centralise for these.
var appSecretsInline = [
  { name: 'database-url', value: dbUrl }
  { name: 'direct-database-url', value: dbDirectUrl }
  { name: 'redis-url', value: redisUrl }
  { name: 'auth-secret', value: authSecret }
  { name: 'azure-storage-connection-string', value: storageConn }
]

// Every other integration secret is a Key Vault reference (see
// `kvSecretSlots` / `kvSecretsAccess` above): the value lives only in the
// vault, an operator sets it with `az keyvault secret set` (or
// `npm run keyvault:push`), and redeploying this template never touches it.
// `kv.name` (not `.properties.vaultUri`) is used because a var's for-loop can
// only reference early-bound resource properties (id/name/type/apiVersion) —
// the vault DNS name is deterministic from the name, same as `storageSuffix`
// above; both would need `environment().*Suffix` for sovereign/gov clouds.
var appSecretsFromKv = [
  for slot in kvSecretSlots: {
    name: slot
    keyVaultUrl: 'https://${kv.name}.vault.azure.net/secrets/${slot}'
    identity: uami.id
  }
]

var appSecrets = concat(appSecretsInline, appSecretsFromKv)

var appEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'APP_URL', value: appUrl }
  { name: 'APP_LOCALES', value: 'pt-BR,en,es' }
  { name: 'APP_DEFAULT_LOCALE', value: 'pt-BR' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'AZURE_STORAGE_CONTAINER', value: 'uploads' }
  { name: 'STORAGE_PUBLIC_URL', value: storagePublicUrl }
  { name: 'EMAIL_FROM', value: 'Barber SaaS <no-reply@example.com>' } // set your verified sender
  { name: 'PLATFORM_FEE_BPS', value: '0' } // your commercial platform fee, basis points
  { name: 'STRIPE_TAX_ENABLED', value: 'false' } // set 'true' after Stripe Tax registrations exist
  { name: 'CHATBOT_MODEL', value: 'claude-sonnet-5' }
  // SDR: keep the module in TEST MODE in staging until leads are reviewed.
  { name: 'SDR_TEST_MODE', value: 'true' }
  { name: 'OPENAI_MODEL', value: 'gpt-4o-mini' }
  { name: 'OPENAI_TRANSCRIBE_MODEL', value: 'whisper-1' }
  { name: 'OPENAI_TTS_MODEL', value: 'gpt-4o-mini-tts' }
  { name: 'OPENAI_TTS_VOICE', value: 'alloy' }
  { name: 'VOICE_PROVIDER', value: 'openai' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'DIRECT_DATABASE_URL', secretRef: 'direct-database-url' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
  { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'azure-storage-connection-string' }
  { name: 'STRIPE_SECRET_KEY', secretRef: 'stripe-secret-key' }
  { name: 'STRIPE_PUBLISHABLE_KEY', secretRef: 'stripe-publishable-key' }
  { name: 'STRIPE_WEBHOOK_SECRET', secretRef: 'stripe-webhook-secret' }
  { name: 'STRIPE_CONNECT_WEBHOOK_SECRET', secretRef: 'stripe-connect-webhook-secret' }
  { name: 'RESEND_API_KEY', secretRef: 'resend-api-key' }
  { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
  { name: 'WHATSAPP_PHONE_NUMBER_ID', secretRef: 'whatsapp-phone-number-id' }
  { name: 'WHATSAPP_BUSINESS_ACCOUNT_ID', secretRef: 'whatsapp-business-account-id' }
  { name: 'WHATSAPP_ACCESS_TOKEN', secretRef: 'whatsapp-access-token' }
  { name: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', secretRef: 'whatsapp-webhook-verify-token' }
  { name: 'WHATSAPP_APP_SECRET', secretRef: 'whatsapp-app-secret' }
  { name: 'SENTRY_DSN', secretRef: 'sentry-dsn' }
  { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
  { name: 'EXTERNAL_VOICE_BASE_URL', secretRef: 'external-voice-base-url' }
  { name: 'EXTERNAL_VOICE_API_KEY', secretRef: 'external-voice-api-key' }
  { name: 'EXTERNAL_VOICE_ID', secretRef: 'external-voice-id' }
]

var registries = [
  {
    server: acr.properties.loginServer
    identity: uami.id
  }
]
var appIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${uami.id}': {}
  }
}

// ---------------------------------------------------------------------------
// Web app  — default CMD (node server.js)
// ---------------------------------------------------------------------------
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${envPrefix}-web'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, redisApp, kvSecretsAccess]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health/live', port: 3000 }
              initialDelaySeconds: 15
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 6
            }
            {
              // Readiness hits the DB. First connection to Azure PG (TLS + auth)
              // can take a few seconds — keep this tolerant so a cold pool or a
              // transient dependency blip doesn't fail activation.
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 20
              periodSeconds: 15
              timeoutSeconds: 10
              failureThreshold: 10
            }
            {
              type: 'Startup'
              httpGet: { path: '/api/health/live', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 8 : 3
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '80' } }
          }
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Worker — overrides CMD to run the BullMQ consumer
// ---------------------------------------------------------------------------
resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${envPrefix}-worker'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, redisApp, kvSecretsAccess]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          command: ['/app/node_modules/.bin/tsx', 'src/worker/index.ts']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appEnv
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: isProd ? 4 : 2
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------
resource remindersJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${envPrefix}-cron-reminders'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, kvSecretsAccess]
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '*/15 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 600
      replicaRetryLimit: 1
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'reminders'
          image: image
          command: ['/app/node_modules/.bin/tsx', 'src/worker/cron/reminders.ts']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnv
        }
      ]
    }
  }
}

resource retryMessagesJob 'Microsoft.App/jobs@2024-03-01' = {
  // Container Apps job names: ≤32 chars — keep the suffix short.
  name: '${envPrefix}-cron-retry'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, kvSecretsAccess]
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '*/5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 300
      replicaRetryLimit: 1
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'retry-messages'
          image: image
          command: ['/app/node_modules/.bin/tsx', 'src/worker/cron/retry-messages.ts']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnv
        }
      ]
    }
  }
}

// SDR / AI Sales Assistant: paced campaign dispatch + outbound retry. Releases
// at most one first-touch per running campaign per tick; enforces send window,
// interval + jitter and daily cap. Downstream `assertContactable` still gates
// TEST MODE / suppression / consent / global cap.
resource sdrDispatchJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${envPrefix}-cron-sdr'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, kvSecretsAccess]
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '*/5 * * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 300
      replicaRetryLimit: 1
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'sdr-dispatch'
          image: image
          command: ['/app/node_modules/.bin/tsx', 'src/worker/cron/sdr-dispatch.ts']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnv
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// One-off migration job — invoke manually from CI before routing traffic:
//   az containerapp job start -n <envPrefix>-migrate -g <rg>
// ---------------------------------------------------------------------------
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${envPrefix}-migrate'
  location: location
  tags: tags
  identity: appIdentity
  dependsOn: [acrPull, kvSecretsAccess]
  properties: {
    environmentId: cae.id
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 600
      replicaRetryLimit: 0
      secrets: appSecrets
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: image
          command: ['/app/node_modules/.bin/prisma', 'migrate', 'deploy']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnv
        }
      ]
    }
  }
}

// AcrPull is granted once, to the shared user-assigned identity, up next to the
// ACR + UAMI definitions (resource `acrPull`).

output acrLoginServer string = acr.properties.loginServer
output webFqdn string = web.properties.configuration.ingress.fqdn
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
output webAppName string = web.name
output workerAppName string = worker.name
