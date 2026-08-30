// Barber SaaS — Azure infrastructure (starting point; review before deploying).
// Resources: Log Analytics, Container Apps env, ACR, Postgres Flexible Server,
// Redis, Storage (Blob), Key Vault, web + worker Container Apps, reminders cron.
//
// Secrets (DB password, Stripe keys, etc.) are NOT set here — put them in Key
// Vault and reference them from the Container Apps as secretRef. This template
// wires the Key Vault + managed identity; populate values out of band.

@description('Base name for all resources, e.g. "barbersaas"')
param namePrefix string

@description('Azure region')
param location string = resourceGroup().location

@description('Environment tag: dev | staging | prod')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'prod'

@description('Container image for the web app, e.g. <acr>.azurecr.io/barber-web:<tag>')
param webImage string

@description('Container image for the worker')
param workerImage string

@description('PostgreSQL administrator login')
param pgAdminLogin string

@secure()
@description('PostgreSQL administrator password')
param pgAdminPassword string

@description('Public base URL of the app, e.g. https://app.example.com')
param appUrl string

var tags = {
  app: 'barber-saas'
  env: environment
}
var suffix = uniqueString(resourceGroup().id, namePrefix)

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Container registry
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
  name: '${namePrefix}-pg-${suffix}'
  location: location
  tags: tags
  sku: {
    name: environment == 'prod' ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    tier: environment == 'prod' ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: environment == 'prod' ? 14 : 7
      geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
  }

  resource db 'databases@2023-12-01-preview' = {
    name: 'barber'
  }

  // Allow Azure services (Container Apps). Tighten to VNet for prod.
  resource fwAzure 'firewallRules@2023-12-01-preview' = {
    name: 'AllowAzureServices'
    properties: {
      startIpAddress: '0.0.0.0'
      endIpAddress: '0.0.0.0'
    }
  }
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------
resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${namePrefix}-redis-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: environment == 'prod' ? 'Standard' : 'Basic'
      family: 'C'
      capacity: environment == 'prod' ? 1 : 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ---------------------------------------------------------------------------
// Storage (Blob) for uploads
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${namePrefix}st${suffix}'
  location: location
  tags: tags
  sku: { name: environment == 'prod' ? 'Standard_ZRS' : 'Standard_LRS' }
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
// Key Vault (populate secret values out of band)
// ---------------------------------------------------------------------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${namePrefix}-kv-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Container Apps environment
// ---------------------------------------------------------------------------
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
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

var redisConn = '${redis.properties.hostName}:${redis.properties.sslPort},password=${redis.listKeys().primaryKey},ssl=True,abortConnect=False'
var dbUrl = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${pg.properties.fullyQualifiedDomainName}:5432/barber?sslmode=require'

var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'APP_URL', value: appUrl }
  { name: 'APP_LOCALES', value: 'pt-BR,en,es' }
  { name: 'APP_DEFAULT_LOCALE', value: 'pt-BR' }
  { name: 'AZURE_STORAGE_CONTAINER', value: 'uploads' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
]

var commonSecrets = [
  { name: 'database-url', value: dbUrl }
  { name: 'redis-url', value: 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:${redis.properties.sslPort}' }
  // Placeholder — replace with a Key Vault reference once the secret exists.
  { name: 'auth-secret', value: 'REPLACE_VIA_KEYVAULT' }
]

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-web'
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
      secrets: commonSecrets
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: commonEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: environment == 'prod' ? 1 : 0
        maxReplicas: 5
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
// Worker
// ---------------------------------------------------------------------------
resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: commonSecrets
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: commonEnv
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reminders cron (Container Apps Job) — hits an internal endpoint every 5 min
// ---------------------------------------------------------------------------
resource remindersJob 'Microsoft.App/jobs@2024-03-01' = {
  name: '${namePrefix}-reminders'
  location: location
  tags: tags
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
      secrets: commonSecrets
    }
    template: {
      containers: [
        {
          name: 'reminders'
          image: workerImage
          command: ['npx', 'tsx', 'src/worker/cron/reminders.ts']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: commonEnv
        }
      ]
    }
  }
}

output acrLoginServer string = acr.properties.loginServer
output webFqdn string = web.properties.configuration.ingress.fqdn
output keyVaultName string = kv.name
output postgresHost string = pg.properties.fullyQualifiedDomainName
