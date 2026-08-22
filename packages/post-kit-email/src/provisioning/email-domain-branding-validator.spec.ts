import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { describe, it } from 'node:test';
import { fetch as undiciFetch } from 'undici';
import {
  createPinnedBimiLogoLookup,
  validateBimiSvgStructure,
  validateEmailDomainBranding,
} from './email-domain-branding-validator';

describe('validateBimiSvgStructure', () => {
  it('accepts a tiny-ps BIMI SVG', () => {
    const svg = '<svg version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"></svg>';
    assert.deepEqual(validateBimiSvgStructure(svg), []);
  });

  it('rejects disallowed structure', () => {
    const svg = '<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>';
    const issues = validateBimiSvgStructure(svg);
    assert.ok(issues.some((issue) => issue.includes('baseProfile')));
    assert.ok(issues.some((issue) => issue.includes('version')));
    assert.ok(issues.some((issue) => issue.includes('<script>')));
  });
});

describe('validateEmailDomainBranding', () => {
  const config = {
    domain: 'mail.example.com',
    dkimSelector: 'fe-test',
    expectedDmarcPolicy: 'reject' as const,
    bimiSelector: 'default',
    expectedBimiLogoUrl: 'https://assets.example.com/logo.svg',
  };

  const validSvg = '<svg version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"></svg>';

  function resolver(records: Record<string, string[]>) {
    return async (hostname: string): Promise<string[]> => records[hostname] ?? [];
  }

  function validDnsRecords(overrides: Record<string, string[]> = {}) {
    return {
      'mail.example.com': ['v=spf1 include:spf.forwardemail.net -all'],
      'fe-test._domainkey.mail.example.com': ['v=DKIM1; k=rsa; p=AAA'],
      '_dmarc.mail.example.com': ['v=DMARC1; p=reject; rua=mailto:dmarc@example.com'],
      'default._bimi.mail.example.com': ['v=BIMI1; l=https://assets.example.com/logo.svg;'],
      ...overrides,
    };
  }

  function hostLookup(addresses: string[], lookupFailed = false) {
    return async (): Promise<{ addresses: string[]; lookupFailed: boolean }> => ({
      addresses,
      lookupFailed,
    });
  }

  function validDeps(
    overrides: {
      dnsResolveTxt?: (hostname: string) => Promise<string[]>;
      dnsLookupHost?: (hostname: string) => Promise<{ addresses: string[]; lookupFailed: boolean }>;
      fetchImpl?: typeof undiciFetch;
    } = {},
  ) {
    return {
      dnsResolveTxt: overrides.dnsResolveTxt ?? resolver(validDnsRecords()),
      dnsLookupHost: overrides.dnsLookupHost ?? hostLookup(['93.184.216.34']),
      fetchImpl: overrides.fetchImpl ?? (async () => new Response(validSvg, { status: 200 })),
    };
  }

  it('passes with valid DNS, logo URL, and BIMI SVG', async () => {
    const report = await validateEmailDomainBranding(config, validDeps());

    assert.equal(report.ok, true);
    assert.equal(report.errors.length, 0);
    assert.ok(report.checks.every((check) => check.status === 'pass' || check.status === 'warn'));
  });

  it('fails with actionable messages when DNS is missing', async () => {
    const report = await validateEmailDomainBranding(config, {
      dnsResolveTxt: resolver({}),
      dnsLookupHost: hostLookup(['93.184.216.34']),
      fetchImpl: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
    });

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('SPF TXT record')));
    assert.ok(report.errors.some((error) => error.includes('DKIM TXT record')));
    assert.ok(report.errors.some((error) => error.includes('DMARC TXT record')));
    assert.ok(report.errors.some((error) => error.includes('BIMI TXT record')));
  });

  it('reports DNS resolver failures distinctly from missing TXT records', async () => {
    const report = await validateEmailDomainBranding(config, {
      dnsResolveTxt: async () => {
        throw new Error('SERVFAIL');
      },
      dnsLookupHost: hostLookup(['93.184.216.34']),
      fetchImpl: async () => new Response(validSvg, { status: 200 }),
    });

    assert.equal(report.ok, false);
    assert.ok(
      report.errors.some((error) => error.includes('DNS lookup failed for mail.example.com')),
    );
    assert.ok(
      report.errors.every(
        (error) =>
          !error.startsWith('No SPF TXT record found') &&
          !error.startsWith('No DKIM TXT record found'),
      ),
    );
  });

  it('fails on DMARC policy mismatch and BIMI logo URL mismatch', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            '_dmarc.mail.example.com': ['v=DMARC1; p=quarantine'],
            'default._bimi.mail.example.com': ['v=BIMI1; l=https://cdn.example.com/logo.svg;'],
          }),
        ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('DMARC policy mismatch')));
    assert.ok(report.errors.some((error) => error.includes('BIMI logo URL mismatch')));
  });

  it('accepts quoted BIMI l= URLs when they match expectedBimiLogoUrl', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            'default._bimi.mail.example.com': ['v=BIMI1; l="https://assets.example.com/logo.svg";'],
          }),
        ),
      }),
    );

    assert.equal(report.ok, true);
    assert.ok(report.checks.some((check) => check.id === 'bimi-record' && check.status === 'pass'));
  });

  it('fails when multiple SPF TXT records are present', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            'mail.example.com': [
              'v=spf1 include:spf.forwardemail.net -all',
              'v=spf1 include:other.example.net -all',
            ],
          }),
        ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('Multiple SPF TXT records')));
  });

  it('fails when SPF record ends with +all', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            'mail.example.com': ['v=spf1 include:spf.forwardemail.net +all'],
          }),
        ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('ends with +all')));
  });

  it('reports host DNS resolver failures distinctly from unresolved hostnames', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup([], true),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(
      report.errors.some((error) => error.includes('DNS lookup failed for assets.example.com')),
    );
    assert.ok(report.errors.every((error) => !error.includes('hostname could not be resolved')));
  });

  it('fails when DMARC pct=0 disables full enforcement', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            '_dmarc.mail.example.com': ['v=DMARC1; p=reject; pct=0'],
          }),
        ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('DMARC pct=0')));
  });

  it('fails when BIMI logo fetch throws a network error', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        fetchImpl: async () => {
          throw new Error('DNS failure');
        },
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('DNS failure')));
    assert.ok(
      report.checks.some((check) => check.id === 'bimi-svg-structure' && check.status === 'skip'),
    );
  });

  it('fails when BIMI logo fetch is redirected', async () => {
    let capturedInit: RequestInit | undefined;
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        fetchImpl: async (_url, init) => {
          capturedInit = init as RequestInit;
          throw new TypeError('redirect mode is set to error');
        },
      }),
    );

    assert.equal(capturedInit?.redirect, 'error');
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('redirect mode is set to error')));
  });

  it('fails when BIMI logo URL targets an unsafe destination', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsResolveTxt: resolver(
          validDnsRecords({
            'default._bimi.mail.example.com': ['v=BIMI1; l=https://127.0.0.1/logo.svg;'],
          }),
        ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('unsafe destination')));
  });

  it('fails when BIMI logo URL resolves to a private address', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['10.0.0.1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to fe80::/10 link-local IPv6', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['fe90::1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to IPv4-mapped loopback', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['::ffff:127.0.0.1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to unspecified IPv6', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['::']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to multicast IPv6', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['ff02::1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to IPv4-compatible loopback', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['::127.0.0.1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to IPv6 documentation range', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['2001:db8::1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('fails when BIMI logo URL resolves to IPv4 documentation range', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        dnsLookupHost: hostLookup(['192.0.2.1']),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('private address')));
  });

  it('pins validated public address for BIMI logo fetch', () => {
    const lookup = createPinnedBimiLogoLookup('93.184.216.34');
    let resolvedAddress: string | undefined;
    let resolvedFamily: number | undefined;

    lookup('assets.example.com', {}, (error, address, family) => {
      assert.equal(error, null);
      resolvedAddress = address;
      resolvedFamily = family;
    });

    assert.equal(resolvedAddress, '93.184.216.34');
    assert.equal(resolvedFamily, 4);
  });

  it('fails when BIMI logo fetch times out', async () => {
    let capturedInit: RequestInit | undefined;
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        fetchImpl: async (_url, init) => {
          capturedInit = init as RequestInit;
          const error = new Error('The operation was aborted');
          error.name = 'TimeoutError';
          throw error;
        },
      }),
    );

    assert.ok(capturedInit?.signal);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('aborted')));
  });

  it('fails when BIMI logo response body exceeds the size limit', async () => {
    const oversizedBody = 'x'.repeat(512 * 1024 + 1);
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(oversizedBody));
                controller.close();
              },
            }),
            { status: 200 },
          ),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('exceeds')));
  });

  it('fails when BIMI logo response returns a non-success status', async () => {
    const report = await validateEmailDomainBranding(
      config,
      validDeps({
        fetchImpl: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    );

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('HTTP 404')));
  });
});
