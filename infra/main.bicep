// Barber SaaS — Azure infrastructure.
//
// One template, parameterised by `environment` (dev | staging | prod). Deploy it
// once per environment into its own resource group. Resources:
//   Log Analytics · ACR · Postgres Flexible Server · Azure Cache for Redis ·
//   Storage (Blob) · Key Vault · Container Apps env · web app · worker app ·
//   two scheduled jobs (reminders, retry-messages).
//
// SECRETS: this template declares every secret SLOT with an empty placeholder
// value. Before go-live, put the real values in Key Vault and switch the
// `secrets[]` entries from inline `value: ''` to
// `keyVaultUrl: '<vault>/secrets/<name>'` + `identity: 'system'`, then redeploy.
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
@description('App session signing secret (48+ random bytes). Generated per deploy; move to Key Vault for go-live.')
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
var dbUrl = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/barber?sslmode=require'
// Internal-only, no auth, no TLS — isolated to the Container Apps env network.
var redisUrl = 'redis://${envPrefix}-redis.internal.${cae.properties.defaultDomain}:6379'
// Azure public cloud suffix (brazilsouth). Change for sovereign/gov clouds.
var storageSuffix = 'core.windows.net'
var storageConn = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${storageSuffix}'
var storagePublicUrl = '${storage.properties.primaryEndpoints.blob}uploads'

// Integration secret SLOTS. The Container Apps API rejects an empty secret
// `value`, so unconfigured slots carry a single space — `env.ts` trims it back
// to "" so `isConfigured.*` stays honest and every feature degrades cleanly.
// Swap each for a Key Vault reference (`keyVaultUrl` + `identity`) at go-live.
var unset = ' '
var appSecrets = [
  { name: 'database-url', value: dbUrl }
  { name: 'redis-url', value: redisUrl }
  { name: 'auth-secret', value: authSecret }
  { name: 'azure-storage-connection-string', value: storageConn }
  { name: 'stripe-secret-key', value: unset }
  { name: 'stripe-publishable-key', value: unset }
  { name: 'stripe-webhook-secret', value: unset }
  { name: 'stripe-connect-webhook-secret', value: unset }
  { name: 'resend-api-key', value: unset }
  { name: 'anthropic-api-key', value: unset }
  { name: 'whatsapp-phone-number-id', value: unset }
  { name: 'whatsapp-business-account-id', value: unset }
  { name: 'whatsapp-access-token', value: unset }
  { name: 'whatsapp-webhook-verify-token', value: unset }
  { name: 'whatsapp-app-secret', value: unset }
  { name: 'sentry-dsn', value: unset }
]

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
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'DIRECT_DATABASE_URL', secretRef: 'database-url' }
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
]

var registries = [
  {
    server: acr.properties.loginServer
    identity: 'system'
  }
]

// ---------------------------------------------------------------------------
// Web app  — default CMD (node server.js)
// ---------------------------------------------------------------------------
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${envPrefix}-web'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
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
              initialDelaySeconds: 10
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 15
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/api/health/live', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 12
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
  identity: { type: 'SystemAssigned' }
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
          command: ['npx', 'tsx', 'src/worker/index.ts']
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
  identity: { type: 'SystemAssigned' }
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
          command: ['npx', 'tsx', 'src/worker/cron/reminders.ts']
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
  identity: { type: 'SystemAssigned' }
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
          command: ['npx', 'tsx', 'src/worker/cron/retry-messages.ts']
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
  identity: { type: 'SystemAssigned' }
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
          command: ['npx', 'prisma', 'migrate', 'deploy']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnv
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Let every app / job pull the image from ACR with its managed identity.
// (Key Vault "Secrets User" is granted out of band — see docs/deployment/keyvault.md.)
// ---------------------------------------------------------------------------
var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
// One explicit assignment per identity. A `for` loop can't be used here: its
// iterator (the array) must be knowable at the start of the deployment, and
// `<app>.identity.principalId` is only known after the app is created (BCP178).
resource acrPullWeb 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, web.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullWorker 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, worker.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: worker.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullReminders 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, remindersJob.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: remindersJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullRetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, retryMessagesJob.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: retryMessagesJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullMigrate 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, migrateJob.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: migrateJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output webFqdn string = web.properties.configuration.ingress.fqdn
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
output webAppName string = web.name
output workerAppName string = worker.name
