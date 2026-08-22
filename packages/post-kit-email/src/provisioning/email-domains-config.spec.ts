import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEmailDomainsFile } from './email-domains-config';

describe('parseEmailDomainsFile', () => {
  it('parses a valid config', () => {
    const file = parseEmailDomainsFile(
      JSON.stringify({
        version: 1,
        domains: [
          {
            domain: 'mail.example.com',
            zoneDomain: 'example.com',
            aliases: [{ name: 'noreply', recipients: ['hello@example.com'] }],
          },
        ],
      }),
    );
    assert.equal(file.domains[0]?.domain, 'mail.example.com');
    assert.equal(file.domains[0]?.aliases[0]?.name, 'noreply');
  });

  it('rejects a domain outside the zone', () => {
    assert.throws(
      () =>
        parseEmailDomainsFile(
          JSON.stringify({
            version: 1,
            domains: [
              {
                domain: 'mail.other.com',
                zoneDomain: 'example.com',
                aliases: [{ name: 'noreply', recipients: ['hello@example.com'] }],
              },
            ],
          }),
        ),
      /not under/,
    );
  });
});
