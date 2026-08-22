import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRequiredDnsRecords } from './forward-email-management';
import { formatTxt, planRoute53Changes, unquoteTxt } from './route53-plan';

const records = getRequiredDnsRecords({
  domain: 'mail.example.com',
  zoneDomain: 'example.com',
  verificationToken: 'tok',
  existingSpf: 'v=spf1 include:_spf.google.com -all',
  smtpDnsRecords: {
    dkim: { name: 'fe._domainkey.mail.example.com', value: 'v=DKIM1; p=AAA' },
    return_path: { name: 'fe-bounces.mail.example.com', value: 'forwardemail.net' },
    dmarc: { name: '_dmarc.mail.example.com', value: 'v=DMARC1; p=reject' },
  },
});

describe('planRoute53Changes', () => {
  it('upserts apex TXT/MX and child records', () => {
    const plan = planRoute53Changes({
      domain: 'mail.example.com',
      zoneDomain: 'example.com',
      records,
      existing: [
        {
          name: 'mail.example.com',
          type: 'TXT',
          values: ['"v=spf1 include:_spf.google.com -all"', '"unrelated=keep"'],
        },
      ],
    });
    assert.equal(plan.apexCnameConflict, false);
    const apexTxt = plan.changes.find((c) => c.purpose === 'apex-txt');
    assert.ok(apexTxt?.values.some((v) => v.includes('unrelated=keep')));
    assert.ok(apexTxt?.values.some((v) => v.includes('include:_spf.google.com')));
    assert.ok(apexTxt?.values.some((v) => v.includes('include:spf.forwardemail.net')));
    assert.ok(apexTxt?.values.some((v) => v.includes('forward-email-site-verification=tok')));
    assert.ok(plan.changes.some((c) => c.type === 'MX' && c.values.length === 2));
    assert.ok(plan.changes.some((c) => c.purpose === 'dkim'));
    assert.ok(plan.changes.some((c) => c.purpose === 'return-path' && c.type === 'CNAME'));
  });

  it('skips apex MX/TXT when a CNAME is present', () => {
    const plan = planRoute53Changes({
      domain: 'mail.example.com',
      zoneDomain: 'example.com',
      records,
      existing: [{ name: 'mail.example.com', type: 'CNAME', values: ['swa.example.net.'] }],
    });
    assert.equal(plan.apexCnameConflict, true);
    assert.equal(
      plan.changes.some((c) => c.purpose === 'apex-txt' || c.purpose === 'mx'),
      false,
    );
    assert.ok(plan.changes.some((c) => c.purpose === 'dkim'));
  });

  it('skips conflicting DMARC unless forced', () => {
    const skipped = planRoute53Changes({
      domain: 'mail.example.com',
      zoneDomain: 'example.com',
      records,
      existing: [
        {
          name: '_dmarc.mail.example.com',
          type: 'TXT',
          values: ['"v=DMARC1; p=none"'],
        },
      ],
    });
    assert.ok(skipped.skipped.some((s) => s.includes('DMARC')));
    assert.equal(
      skipped.changes.some((c) => c.purpose === 'dmarc'),
      false,
    );

    const forced = planRoute53Changes({
      domain: 'mail.example.com',
      zoneDomain: 'example.com',
      records,
      existing: [
        {
          name: '_dmarc.mail.example.com',
          type: 'TXT',
          values: ['"v=DMARC1; p=none"'],
        },
      ],
      forceDmarc: true,
    });
    assert.ok(forced.changes.some((c) => c.purpose === 'dmarc'));
  });

  it('skips empty apex TXT record sets', () => {
    const plan = planRoute53Changes({
      domain: 'mail.example.com',
      zoneDomain: 'example.com',
      records: [],
      existing: [],
    });
    assert.equal(
      plan.changes.some((c) => c.purpose === 'apex-txt'),
      false,
    );
  });

  it('splits TXT values longer than 255 characters', () => {
    const long = `v=DKIM1; p=${'A'.repeat(300)}`;
    const formatted = formatTxt(long);
    assert.equal(formatted.startsWith('"'), true);
    assert.ok(formatted.includes('" "'));
    assert.ok([...formatted.matchAll(/"([^"]*)"/g)].every((chunk) => chunk[1].length <= 255));
    assert.equal(unquoteTxt(formatted), long);
    assert.equal(unquoteTxt('"part1" "part2"'), 'part1part2');
  });
});
