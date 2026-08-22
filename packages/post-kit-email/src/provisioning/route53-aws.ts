import { spawnSync } from 'node:child_process';
import type { Route53Change, Route53RecordSet } from './route53-plan';

export function awsCli(args: string[]): string {
  const result = spawnSync('aws', args, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(
      `AWS CLI not available (${result.error.message}). Install aws and configure credentials from pc-provision, or pass --skip-dns.`,
    );
  }
  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `aws ${args.join(' ')} failed`);
  }
  return result.stdout;
}

export function lookupHostedZoneId(zoneDomain: string): string {
  const raw = awsCli([
    'route53',
    'list-hosted-zones-by-name',
    '--dns-name',
    zoneDomain,
    '--output',
    'json',
  ]);
  const parsed = JSON.parse(raw) as {
    HostedZones?: { Id?: string; Name?: string }[];
  };
  const want = `${zoneDomain}.`.toLowerCase();
  const zone = (parsed.HostedZones ?? []).find((item) => (item.Name ?? '').toLowerCase() === want);
  if (!zone?.Id) {
    throw new Error(`No Route53 hosted zone found for ${zoneDomain}`);
  }
  return zone.Id.replace(/^\/hostedzone\//, '');
}

export function listRecords(zoneId: string, names: string[]): Route53RecordSet[] {
  const unique = [...new Set(names.map((n) => n.replace(/\.$/, '').toLowerCase()))];
  const found: Route53RecordSet[] = [];
  for (const name of unique) {
    for (const type of ['TXT', 'MX', 'CNAME'] as const) {
      const raw = awsCli([
        'route53',
        'list-resource-record-sets',
        '--hosted-zone-id',
        zoneId,
        '--start-record-name',
        `${name}.`,
        '--start-record-type',
        type,
        '--max-items',
        '20',
        '--output',
        'json',
      ]);
      const parsed = JSON.parse(raw) as {
        ResourceRecordSets?: {
          Name?: string;
          Type?: string;
          TTL?: number;
          ResourceRecords?: { Value?: string }[];
        }[];
      };
      for (const set of parsed.ResourceRecordSets ?? []) {
        const setName = (set.Name ?? '').replace(/\.$/, '').toLowerCase();
        if (setName !== name || (set.Type ?? '').toUpperCase() !== type) continue;
        found.push({
          name: setName,
          type,
          ttl: set.TTL,
          values: (set.ResourceRecords ?? []).map((rr) => String(rr.Value ?? '')),
        });
      }
    }
  }
  return found;
}

export function applyChanges(zoneId: string, changes: Route53Change[], dryRun: boolean): void {
  if (changes.length === 0) {
    console.log('No Route53 changes.');
    return;
  }
  const batch = {
    Comment: 'post-kit-email Forward Email DNS',
    Changes: changes.map((change) => ({
      Action: change.action,
      ResourceRecordSet: {
        Name: change.name,
        Type: change.type,
        TTL: change.ttl,
        ResourceRecords: change.values.map((value) => ({ Value: value })),
      },
    })),
  };
  const json = JSON.stringify(batch, null, 2);
  if (dryRun) {
    console.log('WhatIf: Route53 change batch:');
    console.log(json);
    return;
  }
  awsCli([
    'route53',
    'change-resource-record-sets',
    '--hosted-zone-id',
    zoneId,
    '--change-batch',
    json,
  ]);
  console.log(`Applied ${changes.length} Route53 UPSERT(s).`);
}
