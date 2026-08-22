import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearHostProfileMapCache,
  getHostProfileMap,
  resolveContactEmailProfile,
  resolveTenantEmailProfileOverride,
} from './contact-email-profile';
import { EmailProviderError } from '../providers/email-types';

describe('resolveTenantEmailProfileOverride', () => {
  it('extracts email profile fields from tenant settings', () => {
    const profile = resolveTenantEmailProfileOverride({
      email: {
        fromAddress: 'noreply@inkads.mail.singletonsd.com',
        fromName: 'InkAds',
        contactInboxAddress: 'inkads-support@singletonsd.com',
      },
    });
    assert.deepEqual(profile, {
      fromAddress: 'noreply@inkads.mail.singletonsd.com',
      fromName: 'InkAds',
      contactInboxAddress: 'inkads-support@singletonsd.com',
    });
  });

  it('returns undefined when email settings are empty', () => {
    assert.equal(resolveTenantEmailProfileOverride({}), undefined);
    assert.equal(resolveTenantEmailProfileOverride({ email: {} }), undefined);
  });

  it('rejects invalid tenant email field types', () => {
    assert.throws(
      () =>
        resolveTenantEmailProfileOverride({
          email: { fromAddress: 123 },
        }),
      (error: unknown) =>
        error instanceof EmailProviderError &&
        error.kind === 'configuration' &&
        error.message.includes('settings.email.fromAddress'),
    );
  });
});

describe('getHostProfileMap', () => {
  it('memoizes the parsed map for the same raw JSON', () => {
    clearHostProfileMapCache();
    const raw = JSON.stringify({
      'inkads.poc.singletonsd.com': {
        fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
      },
    });
    const first = getHostProfileMap(raw, 'development');
    const second = getHostProfileMap(raw, 'development');
    assert.equal(first, second);
  });

  it('invalidates the cache when the raw JSON changes', () => {
    clearHostProfileMapCache();
    const first = getHostProfileMap(
      JSON.stringify({
        'a.example.com': { fromName: 'A' },
      }),
      'development',
    );
    const second = getHostProfileMap(
      JSON.stringify({
        'b.example.com': { fromName: 'B' },
      }),
      'development',
    );
    assert.notEqual(first, second);
    assert.equal(second['b.example.com']?.fromName, 'B');
  });

  it('rejects non-object host profile entries', () => {
    clearHostProfileMapCache();
    assert.throws(
      () =>
        getHostProfileMap(JSON.stringify({ 'evil.example.com': 'not-an-object' }), 'development'),
      (error: unknown) =>
        error instanceof EmailProviderError && error.message.includes('must be an object'),
    );
  });

  it('rejects invalid supplied host profile fields', () => {
    clearHostProfileMapCache();
    assert.throws(
      () =>
        getHostProfileMap(
          JSON.stringify({
            'inkads.poc.singletonsd.com': { contactInboxAddress: '' },
          }),
          'development',
        ),
      (error: unknown) =>
        error instanceof EmailProviderError && error.message.includes('contactInboxAddress'),
    );
  });
});

describe('resolveContactEmailProfile', () => {
  const baseEnv = {
    EMAIL_PROVIDER: 'development',
    EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
    EMAIL_FROM_NAME: 'Plattform Kit',
    CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
  };

  it('uses defaults when no tenant/host overrides exist', () => {
    const profile = resolveContactEmailProfile({ env: baseEnv });
    assert.deepEqual(profile, {
      fromAddress: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      fromName: 'Plattform Kit',
      contactInboxAddress: 'hello@singletonsd.com',
    });
  });

  it('applies tenant override before host mapping', () => {
    const profile = resolveContactEmailProfile({
      env: baseEnv,
      tenantSettings: {
        email: {
          fromAddress: 'noreply@inkads.mail.singletonsd.com',
          fromName: 'InkAds',
          contactInboxAddress: 'inkads-support@singletonsd.com',
        },
      },
    });
    assert.deepEqual(profile, {
      fromAddress: 'noreply@inkads.mail.singletonsd.com',
      fromName: 'InkAds',
      contactInboxAddress: 'inkads-support@singletonsd.com',
    });
  });

  it('applies trusted host override after tenant override', () => {
    clearHostProfileMapCache();
    const profile = resolveContactEmailProfile({
      env: {
        ...baseEnv,
        CONTACT_EMAIL_PROFILES_BY_HOST: JSON.stringify({
          'inkads.poc.singletonsd.com': {
            fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
            fromName: 'InkAds PoC',
          },
        }),
      },
      trustedRequestHost: 'inkads.poc.singletonsd.com',
      tenantSettings: {
        email: {
          fromAddress: 'noreply@tenant.mail.singletonsd.com',
          fromName: 'Tenant Level',
          contactInboxAddress: 'tenant-support@singletonsd.com',
        },
      },
    });
    assert.deepEqual(profile, {
      fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
      fromName: 'InkAds PoC',
      contactInboxAddress: 'tenant-support@singletonsd.com',
    });
  });

  it('ignores host overrides when trustedRequestHost is not supplied', () => {
    clearHostProfileMapCache();
    const profile = resolveContactEmailProfile({
      env: {
        ...baseEnv,
        CONTACT_EMAIL_PROFILES_BY_HOST: JSON.stringify({
          'inkads.poc.singletonsd.com': {
            fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
          },
        }),
      },
    });
    assert.equal(profile.fromAddress, 'noreply@mail.plattform-kit.poc.singletonsd.com');
  });

  it('validates explicit profile overrides before returning', () => {
    assert.throws(
      () =>
        resolveContactEmailProfile({
          env: baseEnv,
          profileOverride: { fromAddress: 'not-an-email' },
        }),
      (error: unknown) =>
        error instanceof EmailProviderError && error.message.includes('fromAddress'),
    );
  });

  it('rejects malformed host profile JSON', () => {
    clearHostProfileMapCache();
    assert.throws(
      () =>
        resolveContactEmailProfile({
          env: {
            ...baseEnv,
            CONTACT_EMAIL_PROFILES_BY_HOST: '{bad-json}',
          },
          trustedRequestHost: 'inkads.poc.singletonsd.com',
        }),
      (error: unknown) =>
        error instanceof EmailProviderError &&
        error.kind === 'configuration' &&
        error.message.includes('CONTACT_EMAIL_PROFILES_BY_HOST'),
    );
  });
});
