// PostKit contact/send Azure Functions — Linux Consumption in rg-ssd-global.
// Secrets: FORWARD_EMAIL_TOKEN from existing Key Vault (never GitHub Secrets).
// CAF: ssd-postkit-api-prod-ae

@description('Azure region')
param location string = resourceGroup().location

@description('Function App name (CAF)')
param functionAppName string = 'ssd-postkit-api-prod-ae'

@description('Storage account for Functions (3-24 lowercase alphanumeric)')
param storageAccountName string = 'ssdpostkitstprodae'

@description('App Service plan name (Y1 Linux Consumption)')
param planName string = 'ssd-postkit-plan-prod-ae'

@description('Existing Key Vault name in this resource group')
param keyVaultName string = 'ssd-global-kv-prod-ae'

@description('Comma-separated allowed Origin hostnames (no scheme)')
param origins string = '*.poc.singletonsd.com,localhost:4321'

@description('Contact inbox destination')
param contactInboxAddress string = 'hello@singletonsd.com'

@description('Transactional From address (Forward Email alias)')
param emailFromAddress string = 'noreply@mail.plattform-kit.poc.singletonsd.com'

@description('From display name')
param emailFromName string = 'Plattform Kit'

@description('JSON map of marketing host → sender/inbox (CONTACT_EMAIL_PROFILES_BY_HOST)')
param contactEmailProfilesByHost string = '{"inkads.poc.singletonsd.com":{"fromAddress":"noreply@mail.inkads.poc.singletonsd.com","fromName":"InkAds","contactInboxAddress":"inkads-support@singletonsd.com"},"plattform-kit.poc.singletonsd.com":{"fromAddress":"noreply@mail.plattform-kit.poc.singletonsd.com","fromName":"Plattform Kit","contactInboxAddress":"hello@singletonsd.com"}}'

@description('KV secret name for Forward Email API token')
param forwardEmailSecretName string = 'forwardemail-api-key'

var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

var storageConnection = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    reserved: true
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnection
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnection
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'AzureWebJobsFeatureFlags'
          value: 'EnableWorkerIndexing'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'ORIGINS'
          value: origins
        }
        {
          name: 'FORWARD_EMAIL_TOKEN'
          value: '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/${forwardEmailSecretName}/)'
        }
        {
          name: 'FORWARD_EMAIL_BASE_URL'
          value: 'https://api.forwardemail.net'
        }
        {
          name: 'EMAIL_PROVIDER'
          value: 'forward-email'
        }
        {
          name: 'EMAIL_ALLOW_PRODUCTION_SEND'
          value: 'true'
        }
        {
          name: 'EMAIL_FROM_ADDRESS'
          value: emailFromAddress
        }
        {
          name: 'EMAIL_FROM_NAME'
          value: emailFromName
        }
        {
          name: 'CONTACT_INBOX_ADDRESS'
          value: contactInboxAddress
        }
        {
          name: 'CONTACT_EMAIL_PROFILES_BY_HOST'
          value: contactEmailProfilesByHost
        }
        {
          name: 'CONTACT_RATE_LIMIT_PER_MIN'
          value: '5'
        }
      ]
    }
  }
}

resource kvFunctionSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, roleKeyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
output baseUrl string = 'https://${functionApp.properties.defaultHostName}'
