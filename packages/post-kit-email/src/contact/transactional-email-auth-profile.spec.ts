import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractEmailDomain,
  loadTransactionalEmailAuthProfile,
  validateResolvedSenderDomainAlignment,
  validateTransactionalEmailAuthProfile,
} from './transactional-email-auth-profile';

describe('loadTransactionalEmailAuthProfile', () => {
  it('derives sending domain from from-address when unset', () => {
    const profile = loadTransactionalEmailAuthProfile({
      EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
    });
    assert.equal(profile.sendingDomain, 'mail.example.test');
    assert.equal(profile.dmarcPolicy, 'quarantine');
  });

  it('honours explicit domain and DMARC policy', () => {
    const profile = loadTransactionalEmailAuthProfile({
      EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
      EMAIL_SENDING_DOMAIN: 'mail.brand.test',
      EMAIL_DMARC_POLICY: 'reject',
      EMAIL_DMARC_RUA: 'mailto:dmarc-reports@example.test',
    });
    assert.equal(profile.sendingDomain, 'mail.brand.test');
    assert.equal(profile.dmarcPolicy, 'reject');
    assert.equal(profile.dmarcAggregateReportAddress, 'mailto:dmarc-reports@example.test');
  });
});

describe('validateTransactionalEmailAuthProfile', () => {
  it('rejects misaligned from-address domain', () => {
    const errors = validateTransactionalEmailAuthProfile(
      loadTransactionalEmailAuthProfile({
        EMAIL_FROM_ADDRESS: 'noreply@other-domain.test',
        EMAIL_SENDING_DOMAIN: 'mail.example.test',
      }),
    );
    assert.ok(errors.some((error) => error.includes('must align')));
  });

  it('requires mailto prefix for DMARC rua', () => {
    const errors = validateTransactionalEmailAuthProfile(
      loadTransactionalEmailAuthProfile({
        EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
        EMAIL_SENDING_DOMAIN: 'mail.example.test',
        EMAIL_DMARC_RUA: 'dmarc@example.test',
      }),
    );
    assert.ok(errors.some((error) => error.includes('mailto')));
  });

  it('rejects invalid comma-separated DMARC rua entries', () => {
    const errors = validateTransactionalEmailAuthProfile(
      loadTransactionalEmailAuthProfile({
        EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
        EMAIL_SENDING_DOMAIN: 'mail.example.test',
        EMAIL_DMARC_RUA: 'mailto:reports@example.test,https://example.test',
      }),
    );
    assert.ok(errors.some((error) => error.includes('mailto:')));
  });

  it('rejects empty comma-separated DMARC rua entries', () => {
    for (const rua of [
      'mailto:reports@example.test,',
      ',mailto:reports@example.test',
      'mailto:a@example.test,,mailto:b@example.test',
    ]) {
      const errors = validateTransactionalEmailAuthProfile(
        loadTransactionalEmailAuthProfile({
          EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
          EMAIL_SENDING_DOMAIN: 'mail.example.test',
          EMAIL_DMARC_RUA: rua,
        }),
      );
      assert.ok(errors.some((error) => error.includes('empty comma-separated')));
    }
  });

  it('rejects monitoring-only DMARC policy', () => {
    const errors = validateTransactionalEmailAuthProfile(
      loadTransactionalEmailAuthProfile({
        EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
        EMAIL_SENDING_DOMAIN: 'mail.example.test',
        EMAIL_DMARC_POLICY: 'none',
      }),
      { EMAIL_DMARC_POLICY: 'none' },
    );
    assert.ok(errors.some((error) => error.includes('none is not allowed')));
  });
});

describe('validateResolvedSenderDomainAlignment', () => {
  it('rejects tenant overrides that break sending-domain alignment', () => {
    const errors = validateResolvedSenderDomainAlignment('noreply@other-domain.test', {
      EMAIL_FROM_ADDRESS: 'noreply@mail.example.test',
      EMAIL_SENDING_DOMAIN: 'mail.example.test',
    });
    assert.ok(errors.some((error) => error.includes('align')));
  });
});

describe('extractEmailDomain', () => {
  it('returns null for malformed values', () => {
    assert.equal(extractEmailDomain(''), null);
    assert.equal(extractEmailDomain('no-at-sign'), null);
    assert.equal(extractEmailDomain('foo@'), null);
  });
});
