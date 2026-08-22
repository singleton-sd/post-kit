#!/usr/bin/env node
import path from 'node:path';
import { loadEmailDomainsFile } from '../provisioning/email-domains-config';
import { provisionDomain } from '../provisioning/provision-domain';

function parseArgs(argv: string[]) {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for ${name}`);
    }
    return next;
  };
  const configPath =
    value('--config') ?? path.resolve(__dirname, '../../config/email-domains.json');
  return {
    configPath,
    domain: value('--domain'),
    dryRun: argv.includes('--dry-run'),
    skipDns: argv.includes('--skip-dns'),
    skipVerify: argv.includes('--skip-verify'),
    forceDmarc: argv.includes('--force-dmarc'),
    hostedZoneId: value('--hosted-zone-id'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = loadEmailDomainsFile(args.configPath);
  const selected = args.domain
    ? file.domains.filter((item) => item.domain === args.domain)
    : file.domains;
  if (selected.length === 0) {
    throw new Error(args.domain ? `No config entry for ${args.domain}` : 'No domains in config');
  }
  for (const item of selected) {
    const config = args.hostedZoneId ? { ...item, hostedZoneId: args.hostedZoneId } : item;
    await provisionDomain(config, {
      dryRun: args.dryRun,
      skipDns: args.skipDns,
      skipVerify: args.skipVerify,
      forceDmarc: args.forceDmarc,
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
