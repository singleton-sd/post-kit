import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { ConfigurationSetting } from '@azure/app-configuration';
import {
  ensureAppConfiguration,
  loadAppConfiguration,
  resetAppConfigurationCache,
} from './app-configuration';

describe('loadAppConfiguration', () => {
  const touched = [
    'AZURE_APPCONFIGURATION_ENDPOINT',
    'ORIGINS',
    'CONTACT_EMAIL_PROFILES_BY_HOST',
    'FORWARD_EMAIL_TOKEN',
    'RECIPIENT_HASH_HMAC_KEY',
    'RECIPIENT_HASH_HMAC_KEY_VERSION',
    'EMAIL_FROM_ADDRESS',
    'TEMPLATE_STORAGE_ACCOUNT',
    'TEMPLATE_STORAGE_CONTAINER',
  ];
  const prior = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of touched) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    resetAppConfigurationCache();
  });

  afterEach(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAppConfigurationCache();
  });

  it('does nothing when no endpoint is configured', async () => {
    let listed = false;
    await loadAppConfiguration({
      listSettings: () => {
        listed = true;
        return settings();
      },
    });
    assert.equal(listed, false);
  });

  it('maps plain settings and Key Vault references to environment variables', async () => {
    process.env.AZURE_APPCONFIGURATION_ENDPOINT = 'https://example.azconfig.io';
    const getSecret = async (secretUri: string) => {
      if (secretUri.includes('forwardemail-api-key')) {
        return { value: 'token-from-kv' };
      }
      if (secretUri.includes('recipient-hash-hmac-key')) {
        return {
          value: 'hmac-key-from-kv',
          properties: { version: 'abcd1234eeeeffff0000111122223333' },
        };
      }
      throw new Error(`unexpected secret URI: ${secretUri}`);
    };

    await loadAppConfiguration({
      listSettings: () =>
        settings(
          setting('app:email:origins', '*.poc.singletonsd.com'),
          setting(
            'app:email:profilesByHost',
            '{"inkads.poc.singletonsd.com":{"fromAddress":"noreply@mail.inkads.poc.singletonsd.com"}}',
          ),
          setting(
            'secret:forwardemail-api-key',
            JSON.stringify({
              uri: 'https://ssd-postkit-kv-prod-ae.vault.azure.net/secrets/forwardemail-api-key',
            }),
            'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8',
          ),
          setting(
            'secret:recipient-hash-hmac-key',
            JSON.stringify({
              uri: 'https://ssd-postkit-kv-prod-ae.vault.azure.net/secrets/recipient-hash-hmac-key',
            }),
            'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8',
          ),
          setting('unmapped:key', 'ignored'),
          setting('app:templates:storageAccount', 'ssdpostkitstprodae'),
          setting('app:templates:storageContainer', 'templates'),
        ),
      getSecret,
    });

    assert.equal(process.env.ORIGINS, '*.poc.singletonsd.com');
    assert.equal(process.env.TEMPLATE_STORAGE_ACCOUNT, 'ssdpostkitstprodae');
    assert.equal(process.env.TEMPLATE_STORAGE_CONTAINER, 'templates');
    assert.equal(
      process.env.CONTACT_EMAIL_PROFILES_BY_HOST,
      '{"inkads.poc.singletonsd.com":{"fromAddress":"noreply@mail.inkads.poc.singletonsd.com"}}',
    );
    assert.equal(process.env.FORWARD_EMAIL_TOKEN, 'token-from-kv');
    assert.equal(process.env.RECIPIENT_HASH_HMAC_KEY, 'hmac-key-from-kv');
    assert.equal(process.env.RECIPIENT_HASH_HMAC_KEY_VERSION, 'abcd1234eeeeffff0000111122223333');
    assert.equal(process.env.UNMAPPED_KEY, undefined);
  });

  it('preserves explicitly configured environment variables', async () => {
    process.env.AZURE_APPCONFIGURATION_ENDPOINT = 'https://example.azconfig.io';
    process.env.ORIGINS = 'localhost:4321';

    await loadAppConfiguration({
      listSettings: () => settings(setting('app:email:origins', 'from-store')),
    });

    assert.equal(process.env.ORIGINS, 'localhost:4321');
  });

  it('retries after a failed load instead of caching the rejection', async () => {
    process.env.AZURE_APPCONFIGURATION_ENDPOINT = 'https://example.azconfig.io';
    let calls = 0;
    const failing = {
      listSettings: () =>
        (async function* () {
          calls += 1;
          throw new Error('store unavailable');
        })(),
    };

    await assert.rejects(ensureAppConfiguration(failing), /store unavailable/);
    await assert.rejects(ensureAppConfiguration(failing), /store unavailable/);
    assert.equal(calls, 2);
  });

  it('rejects malformed Key Vault references', async () => {
    process.env.AZURE_APPCONFIGURATION_ENDPOINT = 'https://example.azconfig.io';

    await assert.rejects(
      loadAppConfiguration({
        listSettings: () =>
          settings(
            setting(
              'secret:forwardemail-api-key',
              '{}',
              'application/vnd.microsoft.appconfig.keyvaultref+json',
            ),
          ),
      }),
      /Invalid Key Vault reference for secret:forwardemail-api-key/,
    );
  });
});

function setting(key: string, value: string, contentType?: string): ConfigurationSetting {
  return { key, value, contentType } as ConfigurationSetting;
}

async function* settings(...values: ConfigurationSetting[]) {
  yield* values;
}
