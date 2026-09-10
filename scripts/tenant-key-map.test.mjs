import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  generateTenantApiToken,
  isTenantEnvironment,
  parseTenantKeyMapJson,
  tenantKeyMapKeyVaultReference,
  upsertTenantKeyMapEntry,
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

describe('parseTenantKeyMapJson', () => {
  it('returns empty object for blank input', () => {
    assert.deepEqual(parseTenantKeyMapJson(''), {});
    assert.deepEqual(parseTenantKeyMapJson(undefined), {});
  });

  it('parses a valid map', () => {
    const map = parseTenantKeyMapJson(
      JSON.stringify({
        tk_live_abc1234567890xyz: { tenantId: 'inkads', environment: 'production' },
      }),
    );
    assert.equal(map['tk_live_abc1234567890xyz']?.tenantId, 'inkads');
  });

  it('rejects invalid JSON and shapes', () => {
    assert.throws(() => parseTenantKeyMapJson('{'), /not valid JSON/);
    assert.throws(() => parseTenantKeyMapJson('[]'), /JSON object/);
    assert.throws(
      () => parseTenantKeyMapJson(JSON.stringify({ tk: { tenantId: 'a' } })),
      /invalid/,
    );
  });
});

describe('upsertTenantKeyMapEntry', () => {
  it('preserves existing entries when adding', () => {
    const existing = {
      tk_dev_aaaaaaaaaaaaaaaa: { tenantId: 'acme', environment: 'development' },
    };
    const { map, replaced } = upsertTenantKeyMapEntry(
      existing,
      'tk_live_bbbbbbbbbbbbbbbb',
      'inkads',
      'production',
    );
    assert.equal(replaced, false);
    assert.equal(Object.keys(map).length, 2);
    assert.equal(map['tk_dev_aaaaaaaaaaaaaaaa']?.tenantId, 'acme');
    assert.equal(map['tk_live_bbbbbbbbbbbbbbbb']?.environment, 'production');
    assert.equal(Object.keys(existing).length, 1);
  });

  it('marks replaced when the token already exists', () => {
    const token = 'tk_live_cccccccccccccccc';
    const existing = { [token]: { tenantId: 'old', environment: 'production' } };
    const { map, replaced } = upsertTenantKeyMapEntry(existing, token, 'new', 'production');
    assert.equal(replaced, true);
    assert.equal(map[token]?.tenantId, 'new');
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
