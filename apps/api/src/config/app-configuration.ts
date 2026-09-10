import { AppConfigurationClient, type ConfigurationSetting } from '@azure/app-configuration';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const keyVaultReferenceContentType = 'application/vnd.microsoft.appconfig.keyvaultref+json';

/** App Configuration key → process.env name. Explicit env always wins. */
export const APP_CONFIGURATION_ENVIRONMENT_KEYS: Readonly<Record<string, string>> = {
  'app:email:origins': 'ORIGINS',
  'app:email:provider': 'EMAIL_PROVIDER',
  'app:email:allowProductionSend': 'EMAIL_ALLOW_PRODUCTION_SEND',
  'app:email:fromAddress': 'EMAIL_FROM_ADDRESS',
  'app:email:fromName': 'EMAIL_FROM_NAME',
  'app:email:tenantConfigById': 'TENANT_EMAIL_CONFIG_BY_ID',
  'app:email:tenantProviderAccountSecrets': 'TENANT_PROVIDER_ACCOUNT_SECRETS',
  'app:email:contactInboxAddress': 'CONTACT_INBOX_ADDRESS',
  'app:email:profilesByHost': 'CONTACT_EMAIL_PROFILES_BY_HOST',
  'app:email:rateLimitPerMin': 'CONTACT_RATE_LIMIT_PER_MIN',
  'app:email:sendRateLimitPerMin': 'SEND_RATE_LIMIT_PER_MIN',
  'app:email:sendRateLimitWindowMs': 'SEND_RATE_LIMIT_WINDOW_MS',
  'app:email:sendMaxBodyBytes': 'SEND_MAX_BODY_BYTES',
  'app:email:sendMaxVariablesBytes': 'SEND_MAX_VARIABLES_BYTES',
  'app:email:sendMaxVariableValueBytes': 'SEND_MAX_VARIABLE_VALUE_BYTES',
  'app:email:sendProviderTimeoutMs': 'SEND_PROVIDER_TIMEOUT_MS',
  'app:email:sendMaxAttempts': 'SEND_MAX_ATTEMPTS',
  'app:email:sendRetryBaseDelayMs': 'SEND_RETRY_BASE_DELAY_MS',
  'app:email:forwardEmailBaseUrl': 'FORWARD_EMAIL_BASE_URL',
  'app:email:validation:domain': 'EMAIL_VALIDATION_DOMAIN',
  'app:email:validation:dkimSelector': 'EMAIL_VALIDATION_DKIM_SELECTOR',
  'app:email:validation:dmarcPolicy': 'EMAIL_VALIDATION_DMARC_POLICY',
  'app:email:validation:bimiSelector': 'EMAIL_VALIDATION_BIMI_SELECTOR',
  'app:email:validation:bimiLogoUrl': 'EMAIL_VALIDATION_BIMI_LOGO_URL',
  'app:email:validation:requireBimiSvg': 'EMAIL_VALIDATION_REQUIRE_BIMI_SVG',
  'app:templates:storageAccount': 'TEMPLATE_STORAGE_ACCOUNT',
  'app:templates:storageContainer': 'TEMPLATE_STORAGE_CONTAINER',
  'app:idempotency:storageAccount': 'IDEMPOTENCY_STORAGE_ACCOUNT',
  'app:idempotency:storageContainer': 'IDEMPOTENCY_STORAGE_CONTAINER',
  'app:idempotency:ttlMs': 'IDEMPOTENCY_TTL_MS',
  'secret:forwardemail-api-key': 'FORWARD_EMAIL_TOKEN',
  'secret:recipient-hash-hmac-key': 'RECIPIENT_HASH_HMAC_KEY',
};

/**
 * When a Key Vault reference is resolved, also publish the secret version to
 * this env var (explicit env still wins). Used so `recipientHash` can embed a
 * key-version id without logging key material.
 */
export const KEY_VAULT_VERSION_ENVIRONMENT_KEYS: Readonly<Record<string, string>> = {
  'secret:recipient-hash-hmac-key': 'RECIPIENT_HASH_HMAC_KEY_VERSION',
};

export type KeyVaultSecretResult = {
  value?: string;
  properties?: { version?: string };
};

type AppConfigurationDependencies = {
  listSettings?: () => AsyncIterable<ConfigurationSetting>;
  getSecret?: (secretUri: string) => Promise<KeyVaultSecretResult>;
};

let loadOnce: Promise<void> | undefined;

/**
 * Populate process.env from App Configuration. Missing endpoint is a no-op
 * (unit tests and local overrides). Explicit environment variables win.
 */
export async function loadAppConfiguration(
  dependencies: AppConfigurationDependencies = {},
): Promise<void> {
  const endpoint = process.env.AZURE_APPCONFIGURATION_ENDPOINT;
  if (!endpoint) return;

  const credential = new DefaultAzureCredential();
  const listSettings =
    dependencies.listSettings ??
    (() => new AppConfigurationClient(endpoint, credential).listConfigurationSettings());
  const getSecret =
    dependencies.getSecret ??
    (async (secretUri: string): Promise<KeyVaultSecretResult> => {
      const url = new URL(secretUri);
      const segments = url.pathname.split('/').filter(Boolean);
      // pathname: /secrets/{name} or /secrets/{name}/{version}
      const secretName = segments[1];
      if (!secretName) throw new Error(`Invalid Key Vault secret URI: ${secretUri}`);
      const version = segments[2];
      const client = new SecretClient(url.origin, credential);
      return client.getSecret(secretName, version ? { version } : undefined);
    });

  for await (const setting of listSettings()) {
    const environmentKey = APP_CONFIGURATION_ENVIRONMENT_KEYS[setting.key];
    if (!environmentKey || process.env[environmentKey] !== undefined) continue;

    if (isKeyVaultReference(setting)) {
      const secret = await resolveKeyVaultSecret(setting, getSecret);
      process.env[environmentKey] = secret.value;
      const versionEnvironmentKey = KEY_VAULT_VERSION_ENVIRONMENT_KEYS[setting.key];
      if (
        versionEnvironmentKey &&
        process.env[versionEnvironmentKey] === undefined &&
        secret.properties?.version
      ) {
        process.env[versionEnvironmentKey] = secret.properties.version;
      }
      continue;
    }

    if (setting.value !== undefined) process.env[environmentKey] = setting.value;
  }
}

/** Load once per worker. Safe to call from every Function invocation. */
export function ensureAppConfiguration(
  dependencies: AppConfigurationDependencies = {},
): Promise<void> {
  loadOnce ??= loadAppConfiguration(dependencies).catch((error: unknown) => {
    loadOnce = undefined;
    throw error;
  });
  return loadOnce;
}

export function resetAppConfigurationCache(): void {
  loadOnce = undefined;
}

function isKeyVaultReference(setting: ConfigurationSetting): boolean {
  return setting.contentType?.toLowerCase().startsWith(keyVaultReferenceContentType) ?? false;
}

async function resolveKeyVaultSecret(
  setting: ConfigurationSetting,
  getSecret: (secretUri: string) => Promise<KeyVaultSecretResult>,
): Promise<{ value: string; properties?: { version?: string } }> {
  let uri: string | undefined;
  try {
    uri = JSON.parse(setting.value ?? '').uri;
  } catch {
    // Message includes the App Configuration key, never a secret value.
  }

  if (!uri) {
    throw new Error(`Invalid Key Vault reference for ${setting.key}`);
  }

  const secret = await getSecret(uri);
  if (secret.value === undefined) {
    throw new Error(`Key Vault reference has no value for ${setting.key}`);
  }
  return { value: secret.value, properties: secret.properties };
}
