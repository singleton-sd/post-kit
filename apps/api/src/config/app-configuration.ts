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
  'app:email:contactInboxAddress': 'CONTACT_INBOX_ADDRESS',
  'app:email:profilesByHost': 'CONTACT_EMAIL_PROFILES_BY_HOST',
  'app:email:rateLimitPerMin': 'CONTACT_RATE_LIMIT_PER_MIN',
  'app:email:forwardEmailBaseUrl': 'FORWARD_EMAIL_BASE_URL',
  'app:email:validation:domain': 'EMAIL_VALIDATION_DOMAIN',
  'app:email:validation:dkimSelector': 'EMAIL_VALIDATION_DKIM_SELECTOR',
  'app:email:validation:dmarcPolicy': 'EMAIL_VALIDATION_DMARC_POLICY',
  'app:email:validation:bimiSelector': 'EMAIL_VALIDATION_BIMI_SELECTOR',
  'app:email:validation:bimiLogoUrl': 'EMAIL_VALIDATION_BIMI_LOGO_URL',
  'app:email:validation:requireBimiSvg': 'EMAIL_VALIDATION_REQUIRE_BIMI_SVG',
  'secret:forwardemail-api-key': 'FORWARD_EMAIL_TOKEN',
};

type AppConfigurationDependencies = {
  listSettings?: () => AsyncIterable<ConfigurationSetting>;
  getSecret?: (secretUri: string) => Promise<{ value?: string }>;
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
    (async (secretUri: string) => {
      const url = new URL(secretUri);
      const secretName = url.pathname.split('/').filter(Boolean)[1];
      if (!secretName) throw new Error(`Invalid Key Vault secret URI: ${secretUri}`);
      const client = new SecretClient(url.origin, credential);
      return client.getSecret(secretName);
    });

  for await (const setting of listSettings()) {
    const environmentKey = APP_CONFIGURATION_ENVIRONMENT_KEYS[setting.key];
    if (!environmentKey || process.env[environmentKey] !== undefined) continue;

    const value = isKeyVaultReference(setting)
      ? await resolveKeyVaultReference(setting, getSecret)
      : setting.value;

    if (value !== undefined) process.env[environmentKey] = value;
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

async function resolveKeyVaultReference(
  setting: ConfigurationSetting,
  getSecret: (secretUri: string) => Promise<{ value?: string }>,
): Promise<string | undefined> {
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
  return secret.value;
}
