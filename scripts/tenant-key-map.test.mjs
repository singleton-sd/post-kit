import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  generateTenantApiToken,
  hashApiKey,
  isTenantEnvironment,
  parseTenantKeyRegistryJson,
  principalIdFromApiKey,
  serializeTenantKeyRegistry,
  tenantKeyMapKeyVaultReference,
  upsertHashedKeyRecord,
} from './tenant-key-map.mjs';

describe('isTenantEnvironment', () => {
  it('accepts the three PostKit environments', () => {
    assert.equal(isTenantEnvironment('development'), true);
    assert.equal(isTenantEnvironment('staging'), true);
    assert.equal(isTenantEnvironment('production'), true);
  });

  it('rejects unknown values', () => {
    assert.equal(isTenantEnvironment('prod'), false);
    assert.equal(isTenantEnvironment(''), false);
  });
});

describe('generateTenantApiToken', () => {
  it('uses env short codes and hex payload', () => {
    const fixed = () => Buffer.from('a'.repeat(32), 'utf8');
    assert.match(generateTenantApiToken('development', fixed), /^tk_dev_[0-9a-f]{64}$/);
    assert.match(generateTenantApiToken('staging', fixed), /^tk_stg_[0-9a-f]{64}$/);
    assert.match(generateTenantApiToken('production', fixed), /^tk_live_[0-9a-f]{64}$/);
  });
});

describe('hashApiKey / principalIdFromApiKey', () => {
  it('matches API truncated principal id and never equals the raw token', () => {
    const token = 'tk_dev_test_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hash = hashApiKey(token);
    assert.equal(hash, createHash('sha256').update(token, 'utf8').digest('hex'));
    assert.equal(principalIdFromApiKey(token), `ak_${hash.slice(0, 16)}`);
    assert.notEqual(principalIdFromApiKey(token), token);
  });
});

describe('parseTenantKeyRegistryJson', () => {
  it('returns empty v2 registry for blank input', () => {
    assert.deepEqual(parseTenantKeyRegistryJson(''), {
      schemaVersion: 2,
      keys: {},
    });
    assert.deepEqual(parseTenantKeyRegistryJson(undefined), {
      schemaVersion: 2,
      keys: {},
    });
  });

  it('migrates a pure legacy plaintext map under legacyPlaintext', () => {
    const registry = parseTenantKeyRegistryJson(
      JSON.stringify({
        tk_live_abc1234567890xyz: { tenantId: 'inkads', environment: 'production' },
      }),
    );
    assert.equal(registry.schemaVersion, 2);
    assert.deepEqual(registry.keys, {});
    assert.equal(registry.legacyPlaintext?.['tk_live_abc1234567890xyz']?.tenantId, 'inkads');
  });

  it('parses an existing v2 document', () => {
    const token = 'tk_dev_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const id = principalIdFromApiKey(token);
    const registry = parseTenantKeyRegistryJson(
      JSON.stringify({
        schemaVersion: 2,
        keys: {
          [id]: {
            keyHash: hashApiKey(token),
            tenantId: 'acme',
            environment: 'development',
            scopes: ['email:send'],
            revokedAt: null,
            expiresAt: null,
          },
        },
      }),
    );
    assert.equal(registry.keys[id]?.tenantId, 'acme');
    assert.ok(!JSON.stringify(registry).includes(token));
  });

  it('rejects invalid JSON and shapes', () => {
    assert.throws(() => parseTenantKeyRegistryJson('{'), /not valid JSON/);
    assert.throws(() => parseTenantKeyRegistryJson('[]'), /JSON object/);
    assert.throws(
      () => parseTenantKeyRegistryJson(JSON.stringify({ tk: { tenantId: 'a' } })),
      /invalid/,
    );
  });
});

describe('upsertHashedKeyRecord', () => {
  it('writes only hashes and preserves other keys + legacyPlaintext', () => {
    const legacyToken = 'tk_dev_aaaaaaaaaaaaaaaa';
    const existing = parseTenantKeyRegistryJson(
      JSON.stringify({
        [legacyToken]: { tenantId: 'acme', environment: 'development' },
      }),
    );
    const newToken = 'tk_live_bbbbbbbbbbbbbbbb';
    const { registry, principalId, replaced } = upsertHashedKeyRecord(
      existing,
      newToken,
      'inkads',
      'production',
    );
    assert.equal(replaced, false);
    assert.equal(principalId, principalIdFromApiKey(newToken));
    assert.equal(registry.keys[principalId]?.keyHash, hashApiKey(newToken));
    assert.equal(registry.keys[principalId]?.tenantId, 'inkads');
    assert.ok(!JSON.stringify(registry.keys).includes(newToken));
    assert.equal(registry.legacyPlaintext?.[legacyToken]?.tenantId, 'acme');
    assert.equal(Object.keys(existing.keys).length, 0);
  });

  it('moves a legacy token into keys when re-registered and drops legacyPlaintext entry', () => {
    const token = 'tk_dev_cccccccccccccccc';
    const existing = parseTenantKeyRegistryJson(
      JSON.stringify({
        [token]: { tenantId: 'old', environment: 'development' },
      }),
    );
    const { registry, replaced } = upsertHashedKeyRecord(existing, token, 'new', 'development');
    assert.equal(replaced, false);
    assert.equal(registry.keys[principalIdFromApiKey(token)]?.tenantId, 'new');
    assert.equal(registry.legacyPlaintext, undefined);
    assert.ok(!JSON.stringify(registry).includes(`"${token}"`));
  });

  it('marks replaced when the same principal id already exists in keys', () => {
    const token = 'tk_live_dddddddddddddddd';
    const first = upsertHashedKeyRecord(
      { schemaVersion: 2, keys: {} },
      token,
      'acme',
      'production',
    );
    const second = upsertHashedKeyRecord(first.registry, token, 'acme', 'production');
    assert.equal(second.replaced, true);
    assert.equal(Object.keys(second.registry.keys).length, 1);
  });

  it('rejects invalid expiresAt and unknown scopes', () => {
    assert.throws(
      () =>
        upsertHashedKeyRecord(
          { schemaVersion: 2, keys: {} },
          'tk_live_eeeeeeeeeeeeeeee',
          'acme',
          'production',
          { expiresAt: 'not-iso' },
        ),
      /expiresAt/,
    );
    assert.throws(
      () =>
        upsertHashedKeyRecord(
          { schemaVersion: 2, keys: {} },
          'tk_live_ffffffffffffffff',
          'acme',
          'production',
          { scopes: ['templates:read', 'not:a:scope'] },
        ),
      /scopes/,
    );
  });
});

describe('serializeTenantKeyRegistry', () => {
  it('omits empty legacyPlaintext', () => {
    const json = serializeTenantKeyRegistry({ schemaVersion: 2, keys: {} });
    assert.deepEqual(JSON.parse(json), { schemaVersion: 2, keys: {} });
  });
});

describe('tenantKeyMapKeyVaultReference', () => {
  it('builds the Function App reference syntax', () => {
    assert.equal(
      tenantKeyMapKeyVaultReference('ssd-postkit-kv-prod-ae', 'tenant-key-map'),
      '@Microsoft.KeyVault(SecretUri=https://ssd-postkit-kv-prod-ae.vault.azure.net/secrets/tenant-key-map/)',
    );
  });
});
