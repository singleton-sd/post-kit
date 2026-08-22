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

  it('treats INCLUDE as case-insensitive', () => {
    const value = 'v=spf1 INCLUDE:spf.forwardemail.net -all';
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

  it('allows an apex sending domain', () => {
    const records = getRequiredDnsRecords({
      domain: 'example.com',
      zoneDomain: 'example.com',
      verificationToken: 'apex',
    });
    assert.ok(records.some((r) => r.name === '@' && r.purpose === 'verification'));
    assert.ok(records.some((r) => r.name === '@' && r.purpose === 'spf'));
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

  it('updates an existing alias when recipients change', async () => {
    const methods: string[] = [];
    const client = new ForwardEmailManagementClient({
      apiToken: 'token',
      baseUrl: 'https://api.example.test',
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        methods.push(`${method} ${url}`);
        if (url.includes('/aliases') && method === 'GET') {
          return new Response(
            JSON.stringify([{ id: 'a1', name: 'noreply', recipients: ['old@example.com'] }]),
            { status: 200 },
          );
        }
        if (url.endsWith('/aliases/a1') && method === 'PUT') {
          return new Response(
            JSON.stringify({ id: 'a1', name: 'noreply', recipients: ['hello@singletonsd.com'] }),
            { status: 200 },
          );
        }
        return new Response('unexpected', { status: 500 });
      },
    });
    const updated = await client.ensureAlias('example.com', 'noreply', ['hello@singletonsd.com']);
    assert.equal(updated.created, false);
    assert.deepEqual(updated.alias.recipients, ['hello@singletonsd.com']);
    assert.ok(methods.some((entry) => entry.startsWith('PUT ') && entry.endsWith('/aliases/a1')));
  });

  it('reconciles recipients when create races with another provisioner', async () => {
    const methods: string[] = [];
    let aliasListCalls = 0;
    const client = new ForwardEmailManagementClient({
      apiToken: 'token',
      baseUrl: 'https://api.example.test',
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        methods.push(`${method} ${url}`);
        if (url.includes('/aliases') && method === 'GET') {
          aliasListCalls += 1;
          if (aliasListCalls === 1) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response(
            JSON.stringify([{ id: 'a1', name: 'noreply', recipients: ['old@example.com'] }]),
            { status: 200 },
          );
        }
        if (url.includes('/aliases') && method === 'POST') {
          return new Response('already exists', { status: 409 });
        }
        if (url.endsWith('/aliases/a1') && method === 'PUT') {
          return new Response(
            JSON.stringify({ id: 'a1', name: 'noreply', recipients: ['hello@singletonsd.com'] }),
            { status: 200 },
          );
        }
        return new Response('unexpected', { status: 500 });
      },
    });
    const result = await client.ensureAlias('example.com', 'noreply', ['hello@singletonsd.com']);
    assert.equal(result.created, false);
    assert.deepEqual(result.alias.recipients, ['hello@singletonsd.com']);
    assert.equal(aliasListCalls, 2);
    assert.ok(methods.some((entry) => entry.startsWith('POST ')));
    assert.ok(methods.some((entry) => entry.startsWith('PUT ') && entry.endsWith('/aliases/a1')));
  });

  it('aggregates paginated alias lists', async () => {
    const urls: string[] = [];
    const client = new ForwardEmailManagementClient({
      apiToken: 'token',
      baseUrl: 'https://api.example.test',
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('page=1')) {
          return new Response(
            JSON.stringify([{ id: 'a1', name: 'one', recipients: ['a@example.com'] }]),
            { status: 200, headers: { 'X-Page-Count': '2', 'X-Page-Current': '1' } },
          );
        }
        if (url.includes('page=2')) {
          return new Response(
            JSON.stringify([{ id: 'a2', name: 'noreply', recipients: ['hello@singletonsd.com'] }]),
            { status: 200, headers: { 'X-Page-Count': '2', 'X-Page-Current': '2' } },
          );
        }
        return new Response('unexpected', { status: 500 });
      },
    });
    const aliases = await client.listAliases('example.com');
    assert.deepEqual(
      aliases.map((a) => a.name),
      ['one', 'noreply'],
    );
    assert.ok(urls.every((url) => url.includes('paginate=true')));
    assert.equal(urls.length, 2);
  });
});
