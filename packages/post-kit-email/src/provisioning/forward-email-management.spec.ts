import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ForwardEmailManagementClient,
  getRequiredDnsRecords,
  mergeSpfInclude,
} from './forward-email-management';

describe('mergeSpfInclude', () => {
  it('creates a new SPF record when none exists', () => {
    assert.equal(
      mergeSpfInclude(null, 'spf.forwardemail.net'),
      'v=spf1 include:spf.forwardemail.net -all',
    );
  });

  it('preserves existing includes when merging', () => {
    assert.equal(
      mergeSpfInclude('v=spf1 include:_spf.google.com -all', 'spf.forwardemail.net'),
      'v=spf1 include:_spf.google.com include:spf.forwardemail.net -all',
    );
  });

  it('is idempotent when include already present', () => {
    const value = 'v=spf1 include:spf.forwardemail.net -all';
    assert.equal(mergeSpfInclude(value, 'spf.forwardemail.net'), value);
  });
});

describe('getRequiredDnsRecords', () => {
  it('uses API-provided DKIM/DMARC/Return-Path values', () => {
    const records = getRequiredDnsRecords({
      domain: 'mail.plattform-kit.poc.singletonsd.com',
      zoneDomain: 'singletonsd.com',
      verificationToken: 'abc123',
      smtpDnsRecords: {
        dkim: {
          name: 'fe-test._domainkey.plattform-kit.poc',
          value: 'v=DKIM1; k=rsa; p=AAA',
        },
        return_path: {
          name: 'fe-bounces.plattform-kit.poc',
          value: 'forwardemail.net',
        },
        dmarc: {
          name: '_dmarc.plattform-kit.poc',
          value: 'v=DMARC1; p=reject; pct=100;',
        },
      },
    });
    assert.ok(records.some((r) => r.purpose === 'verification' && r.value.includes('abc123')));
    assert.ok(records.some((r) => r.purpose === 'dkim' && r.value.includes('p=AAA')));
    assert.ok(records.some((r) => r.purpose === 'return-path' && r.type === 'CNAME'));
    assert.ok(records.some((r) => r.purpose === 'dmarc'));
    assert.equal(records.filter((r) => r.purpose === 'mx').length, 2);
  });
});

describe('ForwardEmailManagementClient idempotency', () => {
  it('does not recreate an existing domain', async () => {
    const calls: string[] = [];
    const client = new ForwardEmailManagementClient({
      apiToken: 'token',
      baseUrl: 'https://api.example.test',
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/v1/domains/example.com')) {
          return new Response(
            JSON.stringify({
              id: '1',
              name: 'example.com',
              verification_record: 'tok',
              has_mx_record: false,
              has_txt_record: false,
              has_dkim_record: false,
              has_return_path_record: false,
              has_dmarc_record: false,
              has_spf_record: false,
            }),
            { status: 200 },
          );
        }
        return new Response('unexpected', { status: 500 });
      },
    });
    const result = await client.ensureDomain('example.com');
    assert.equal(result.created, false);
    assert.equal(result.domain.name, 'example.com');
    assert.equal(calls.length, 1);
  });

  it('creates a missing alias once', async () => {
    let aliasListCalls = 0;
    const client = new ForwardEmailManagementClient({
      apiToken: 'token',
      baseUrl: 'https://api.example.test',
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes('/aliases') && (init?.method ?? 'GET') === 'GET') {
          aliasListCalls += 1;
          if (aliasListCalls === 1) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(
            JSON.stringify([{ id: 'a1', name: 'noreply', recipients: ['hello@singletonsd.com'] }]),
            { status: 200 },
          );
        }
        if (url.includes('/aliases') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ id: 'a1', name: 'noreply', recipients: ['hello@singletonsd.com'] }),
            { status: 200 },
          );
        }
        return new Response('unexpected', { status: 500 });
      },
    });
    const created = await client.ensureAlias('example.com', 'noreply', ['hello@singletonsd.com']);
    assert.equal(created.created, true);
    const again = await client.ensureAlias('example.com', 'noreply', ['hello@singletonsd.com']);
    assert.equal(again.created, false);
  });
});
