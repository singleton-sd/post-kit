import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import type { ConfigurationSetting } from '@azure/app-configuration';
import { loadAppConfiguration, resetAppConfigurationCache } from './app-configuration';

describe('loadAppConfiguration', () => {
  const touched = [
    'AZURE_APPCONFIGURATION_ENDPOINT',
    'ORIGINS',
    'CONTACT_EMAIL_PROFILES_BY_HOST',
    'FORWARD_EMAIL_TOKEN',
    'EMAIL_FROM_ADDRESS',
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
      assert.match(secretUri, /forwardemail-api-key/);
      return { value: 'token-from-kv' };
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
              uri: 'https://ssd-global-kv-prod-ae.vault.azure.net/secrets/forwardemail-api-key',
            }),
            'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8',
          ),
          setting('unmapped:key', 'ignored'),
        ),
      getSecret,
    });

    assert.equal(process.env.ORIGINS, '*.poc.singletonsd.com');
    assert.equal(
      process.env.CONTACT_EMAIL_PROFILES_BY_HOST,
      '{"inkads.poc.singletonsd.com":{"fromAddress":"noreply@mail.inkads.poc.singletonsd.com"}}',
    );
    assert.equal(process.env.FORWARD_EMAIL_TOKEN, 'token-from-kv');
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
