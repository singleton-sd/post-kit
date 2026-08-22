// PostKit contact/send Azure Functions — Linux Consumption in rg-ssd-global.
// Secrets: FORWARD_EMAIL_TOKEN from Key Vault via App Configuration KV refs.
// Non-secret settings: Azure App Configuration (Free) ssd-postkit-appcs-prod-ae
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

@description('CAF App Configuration store name')
param appConfigName string = 'ssd-postkit-appcs-prod-ae'

@description('App Configuration SKU — Free is available in this subscription')
@allowed(['Free', 'Developer', 'Standard'])
param appConfigSku string = 'Free'

@description('Entra object id of the GitHub OIDC app (empty skips App Config RBAC for CI)')
param githubOidcPrincipalId string = ''

var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var roleAppConfigDataReader = '516239f1-63e1-4d78-a4de-a74fb236a071'
var roleAppConfigDataOwner = '5ae67dd6-50cb-40e7-96ff-dc2bfa4b606b'

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

resource appConfig 'Microsoft.AppConfiguration/configurationStores@2024-05-01' = {
  name: appConfigName
  location: location
  sku: {
    name: appConfigSku
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
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
          name: 'AZURE_APPCONFIGURATION_ENDPOINT'
          value: appConfig.properties.endpoint
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

resource kvAppConfigSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appConfig.id, roleKeyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: appConfig.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appConfigFunctionReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appConfig.id, functionApp.id, roleAppConfigDataReader)
  scope: appConfig
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAppConfigDataReader)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appConfigOidcOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(githubOidcPrincipalId)) {
  name: guid(appConfig.id, githubOidcPrincipalId, roleAppConfigDataOwner)
  scope: appConfig
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAppConfigDataOwner)
    principalId: githubOidcPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
output baseUrl string = 'https://${functionApp.properties.defaultHostName}'
output appConfigName string = appConfig.name
output appConfigEndpoint string = appConfig.properties.endpoint
