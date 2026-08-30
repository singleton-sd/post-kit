import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { PostKitErrorCode, type TenantContext } from '@singleton-sd/post-kit-types';
import {
  clearTenantEmailConfigCache,
  resolveTenantEmailConfig,
  TenantEmailConfigError,
} from './tenant-email-config';

const INKADS_PROD: TenantContext = { tenantId: 'inkads', environment: 'production' };
const INKADS_DEV: TenantContext = { tenantId: 'inkads', environment: 'development' };

describe('resolveTenantEmailConfig', () => {
  const touched = [
    'TENANT_EMAIL_CONFIG_BY_ID',
    'TENANT_PROVIDER_ACCOUNT_SECRETS',
    'EMAIL_FROM_ADDRESS',
    'EMAIL_FROM_NAME',
    'FORWARD_EMAIL_TOKEN_INKADS',
  ];
  const prior = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of touched) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    clearTenantEmailConfigCache();
  });

  afterEach(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearTenantEmailConfigCache();
  });

  it('throws TENANT_CONFIG_NOT_FOUND when the tenant is absent from the map', () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      other: { production: { fromAddress: 'noreply@other.example.com' } },
    });

    assert.throws(
      () => resolveTenantEmailConfig(INKADS_PROD),
      (error: unknown) => {
        assert.ok(error instanceof TenantEmailConfigError);
        assert.equal(error.code, PostKitErrorCode.TENANT_CONFIG_NOT_FOUND);
        assert.match(error.message, /inkads/);
        assert.match(error.message, /production/);
        return true;
      },
    );
  });

  it('throws TENANT_CONFIG_NOT_FOUND when the environment is absent for a known tenant', () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: { development: { fromAddress: 'dev@inkads.example.com' } },
    });

    assert.throws(
      () => resolveTenantEmailConfig(INKADS_PROD),
      (error: unknown) => {
        assert.ok(error instanceof TenantEmailConfigError);
        assert.equal(error.code, PostKitErrorCode.TENANT_CONFIG_NOT_FOUND);
        return true;
      },
    );
  });

  it('merges tenant overrides with platform defaults for unset fields', () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.EMAIL_FROM_NAME = 'Platform';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromDisplayName: 'InkAds',
          replyTo: 'support@inkads.example.com',
        },
      },
    });

    const resolved = resolveTenantEmailConfig(INKADS_PROD);
    assert.equal(resolved.fromAddress, 'platform@example.com');
    assert.equal(resolved.fromDisplayName, 'InkAds');
    assert.equal(resolved.replyTo, 'support@inkads.example.com');
  });

  it('uses tenant fromAddress when provided', () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: { fromAddress: 'noreply@inkads.example.com' },
      },
    });

    const resolved = resolveTenantEmailConfig(INKADS_PROD);
    assert.equal(resolved.fromAddress, 'noreply@inkads.example.com');
  });

  it('allows an empty tenant entry to inherit all platform defaults', () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.EMAIL_FROM_NAME = 'Platform';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: { production: {} },
    });

    const resolved = resolveTenantEmailConfig(INKADS_PROD);
    assert.equal(resolved.fromAddress, 'platform@example.com');
    assert.equal(resolved.fromDisplayName, 'Platform');
    assert.equal(resolved.replyTo, undefined);
  });

  it('throws TENANT_CONFIG_NOT_FOUND when fromAddress is missing after merge', () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: { production: { fromDisplayName: 'InkAds' } },
    });

    assert.throws(
      () => resolveTenantEmailConfig(INKADS_PROD),
      (error: unknown) => {
        assert.ok(error instanceof TenantEmailConfigError);
        assert.equal(error.code, PostKitErrorCode.TENANT_CONFIG_NOT_FOUND);
        return true;
      },
    );
  });

  it('resolves provider account tokens from referenced env vars without exposing values', () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          providerAccount: 'inkads',
        },
      },
    });
    process.env.TENANT_PROVIDER_ACCOUNT_SECRETS = JSON.stringify({
      inkads: 'FORWARD_EMAIL_TOKEN_INKADS',
    });
    process.env.FORWARD_EMAIL_TOKEN_INKADS = 'secret-token-value';

    const resolved = resolveTenantEmailConfig(INKADS_PROD);
    assert.equal(resolved.providerApiToken, 'secret-token-value');
    assert.equal(resolved.providerAccount, 'inkads');
  });

  it('does not leak provider account identifiers in error messages', () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          providerAccount: 'inkads',
        },
      },
    });
    process.env.TENANT_PROVIDER_ACCOUNT_SECRETS = JSON.stringify({
      inkads: 'FORWARD_EMAIL_TOKEN_INKADS',
    });

    assert.throws(
      () => resolveTenantEmailConfig(INKADS_PROD),
      (error: unknown) => {
        assert.ok(error instanceof TenantEmailConfigError);
        assert.equal(error.code, PostKitErrorCode.TENANT_CONFIG_NOT_FOUND);
        assert.ok(!error.message.includes('inkads'));
        assert.ok(!error.message.includes('FORWARD_EMAIL_TOKEN_INKADS'));
        return true;
      },
    );
  });

  it('rejects malformed TENANT_EMAIL_CONFIG_BY_ID JSON', () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = 'not-json';

    assert.throws(
      () => resolveTenantEmailConfig(INKADS_PROD),
      (error: unknown) => {
        assert.ok(error instanceof TenantEmailConfigError);
        assert.equal(error.code, PostKitErrorCode.TENANT_CONFIG_NOT_FOUND);
        return true;
      },
    );
  });

  it('scopes configuration per environment', () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: { fromAddress: 'prod@inkads.example.com' },
        development: { fromAddress: 'dev@inkads.example.com' },
      },
    });

    assert.equal(resolveTenantEmailConfig(INKADS_PROD).fromAddress, 'prod@inkads.example.com');
    assert.equal(resolveTenantEmailConfig(INKADS_DEV).fromAddress, 'dev@inkads.example.com');
  });
});
