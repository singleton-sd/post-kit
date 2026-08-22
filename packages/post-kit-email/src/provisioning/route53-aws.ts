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

export interface Route53HostedZoneInfo {
  Id?: string;
  Name?: string;
  Config?: { PrivateZone?: boolean };
}

function canonicalZoneName(name: string): string {
  return `${name.replace(/\.$/, '')}.`.toLowerCase();
}

export function selectPublicHostedZoneId(
  zones: Route53HostedZoneInfo[],
  zoneDomain: string,
): string {
  const want = canonicalZoneName(zoneDomain);
  const matches = zones.filter(
    (item) => canonicalZoneName(item.Name ?? '') === want && item.Config?.PrivateZone !== true,
  );
  if (matches.length === 0) {
    throw new Error(`No public Route53 hosted zone found for ${zoneDomain}`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple public Route53 hosted zones found for ${zoneDomain}`);
  }
  const id = matches[0]?.Id;
  if (!id) {
    throw new Error(`No public Route53 hosted zone found for ${zoneDomain}`);
  }
  return id.replace(/^\/hostedzone\//, '');
}

export function assertHostedZoneMatchesDomain(
  zone: Route53HostedZoneInfo,
  zoneDomain: string,
  zoneId: string,
): void {
  if (zone.Config?.PrivateZone === true) {
    throw new Error(`Hosted zone ${zoneId} is private; refusing to provision public email DNS`);
  }
  if (canonicalZoneName(zone.Name ?? '') !== canonicalZoneName(zoneDomain)) {
    throw new Error(
      `Hosted zone ${zoneId} name ${zone.Name ?? '(unknown)'} does not match ${zoneDomain}`,
    );
  }
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
  const parsed = JSON.parse(raw) as { HostedZones?: Route53HostedZoneInfo[] };
  return selectPublicHostedZoneId(parsed.HostedZones ?? [], zoneDomain);
}

export function resolveHostedZoneId(zoneDomain: string, hostedZoneId?: string): string {
  if (!hostedZoneId) return lookupHostedZoneId(zoneDomain);
  const raw = awsCli(['route53', 'get-hosted-zone', '--id', hostedZoneId, '--output', 'json']);
  const parsed = JSON.parse(raw) as { HostedZone?: Route53HostedZoneInfo };
  if (!parsed.HostedZone) {
    throw new Error(`No Route53 hosted zone found for id ${hostedZoneId}`);
  }
  assertHostedZoneMatchesDomain(parsed.HostedZone, zoneDomain, hostedZoneId);
  return hostedZoneId.replace(/^\/hostedzone\//, '');
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
