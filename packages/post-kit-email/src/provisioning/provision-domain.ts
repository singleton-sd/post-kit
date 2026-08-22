import { setTimeout as delay } from 'node:timers/promises';
import { ForwardEmailManagementClient, getRequiredDnsRecords } from './forward-email-management';
import type { EmailDomainConfig } from './email-domains-config';
import { fqdn, planRoute53Changes } from './route53-plan';
import { applyChanges, listRecords, lookupHostedZoneId } from './route53-aws';

export interface ProvisionOptions {
  dryRun?: boolean;
  skipDns?: boolean;
  skipVerify?: boolean;
  forceDmarc?: boolean;
  maxVerifyAttempts?: number;
  verifyDelaySeconds?: number;
}

export async function provisionDomain(
  config: EmailDomainConfig,
  options: ProvisionOptions = {},
): Promise<{ pendingVerify: boolean }> {
  const dryRun = Boolean(options.dryRun);
  console.log(`Provisioning Forward Email domain: ${config.domain} (zone ${config.zoneDomain})`);

  const client = new ForwardEmailManagementClient();
  const existing = await client.getDomain(config.domain);
  if (!existing && dryRun) {
    console.log(`WhatIf: would POST /v1/domains domain=${config.domain} plan=team.`);
    console.log('WhatIf: skipping DNS/alias that require API domain payload.');
    return { pendingVerify: false };
  }
  const ensured = existing
    ? { domain: existing, created: false }
    : await client.ensureDomain(config.domain);
  if (ensured.created) console.log('Created Forward Email domain.');
  else console.log('Domain already exists in Forward Email.');

  const token = ensured.domain.verificationRecord;
  if (!token) {
    throw new Error('Forward Email domain response missing verification_record.');
  }

  if (!options.skipDns) {
    const zoneId = config.hostedZoneId || lookupHostedZoneId(config.zoneDomain);
    console.log(`Using hosted zone ${zoneId} (${config.zoneDomain})`);
    const required = getRequiredDnsRecords({
      domain: config.domain,
      zoneDomain: config.zoneDomain,
      verificationToken: token.replace(/^forward-email-site-verification=/, ''),
      smtpDnsRecords: ensured.domain.smtpDnsRecords,
    });
    const names = [
      config.domain,
      ...required.map((record) => fqdn(record.name, config.zoneDomain)),
    ];
    const existingSets = listRecords(zoneId, names);
    const plan = planRoute53Changes({
      domain: config.domain,
      zoneDomain: config.zoneDomain,
      records: required,
      existing: existingSets,
      forceDmarc: options.forceDmarc,
    });
    for (const note of plan.skipped) console.warn(note);
    applyChanges(zoneId, plan.changes, dryRun);
  }

  if (!dryRun) {
    for (const alias of config.aliases) {
      const result = await client.ensureAlias(config.domain, alias.name, alias.recipients);
      console.log(
        result.created
          ? `Created alias ${alias.name} → ${alias.recipients.join(', ')}`
          : `Alias ${alias.name} already exists.`,
      );
    }
  } else {
    for (const alias of config.aliases) {
      console.log(`WhatIf: would ensure alias ${alias.name} → ${alias.recipients.join(', ')}`);
    }
  }

  if (options.skipVerify || dryRun) return { pendingVerify: false };

  const attempts = options.maxVerifyAttempts ?? 6;
  const waitSec = options.verifyDelaySeconds ?? 20;
  let pending = false;
  for (let i = 1; i <= attempts; i += 1) {
    const records = await client.verifyRecords(config.domain);
    const smtp = await client.verifySmtp(config.domain);
    if (records.ok && smtp.ok) {
      console.log('verify-records and verify-smtp succeeded.');
      return { pendingVerify: false };
    }
    pending = true;
    console.log(
      `Verify attempt ${i}/${attempts} pending (records=${records.status}, smtp=${smtp.status}).`,
    );
    if (i < attempts) await delay(waitSec * 1000);
  }
  console.log('Verification still pending after retries — re-run later (exit 0).');
  return { pendingVerify: pending };
}
