import type { ForwardEmailDnsRecord } from './forward-email-management';

export interface Route53RecordSet {
  name: string;
  type: 'TXT' | 'MX' | 'CNAME';
  ttl?: number;
  values: string[];
}

export interface Route53Change {
  action: 'UPSERT';
  name: string;
  type: 'TXT' | 'MX' | 'CNAME';
  ttl: number;
  values: string[];
  purpose: string;
}

export interface PlanRoute53Input {
  domain: string;
  zoneDomain: string;
  records: ForwardEmailDnsRecord[];
  existing: Route53RecordSet[];
  forceDmarc?: boolean;
  ttl?: number;
}

export interface Route53Plan {
  apexCnameConflict: boolean;
  skipped: string[];
  changes: Route53Change[];
}

const DEFAULT_TTL = 300;

export function fqdn(relative: string, zoneDomain: string): string {
  if (!relative || relative === '@') return zoneDomain;
  const cleaned = relative.replace(/\.$/, '');
  if (cleaned === zoneDomain || cleaned.endsWith(`.${zoneDomain}`)) return cleaned;
  return `${cleaned}.${zoneDomain}`;
}

export function formatTxt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

export function formatMx(priority: number, host: string): string {
  const h = host.trim().replace(/\.$/, '');
  return `${priority} ${h}.`;
}

export function formatCname(target: string): string {
  const t = target.trim().replace(/\.$/, '');
  return `${t}.`;
}

export function planRoute53Changes(input: PlanRoute53Input): Route53Plan {
  const ttl = input.ttl ?? DEFAULT_TTL;
  const apex = fqdn(relativeName(input.domain, input.zoneDomain), input.zoneDomain);
  const existingByKey = new Map(
    input.existing.map((set) => [`${normalizeName(set.name)}|${set.type}`, set]),
  );
  const apexCname = existingByKey.get(`${normalizeName(apex)}|CNAME`);
  const skipped: string[] = [];
  const changes: Route53Change[] = [];

  const skipApex = Boolean(apexCname);
  if (skipApex) {
    skipped.push(
      `CNAME on ${apex} — skipping apex MX/TXT (RFC 1034). Child DKIM/Return-Path/DMARC still apply.`,
    );
  }

  const apexTxtExisting = existingByKey.get(`${normalizeName(apex)}|TXT`);
  const apexTxtValues = apexTxtExisting?.values.map(unquoteTxt) ?? [];

  if (!skipApex) {
    const verification = input.records.find((r) => r.purpose === 'verification');
    const spf = input.records.find((r) => r.purpose === 'spf');
    const mx = input.records.filter((r) => r.purpose === 'mx');

    const kept = apexTxtValues.filter((value) => {
      const lower = value.toLowerCase();
      return !lower.startsWith('v=spf1') && !lower.startsWith('forward-email-site-verification=');
    });
    const desiredTxt = [
      ...kept,
      ...(spf ? [spf.value] : []),
      ...(verification ? [verification.value] : []),
    ];
    changes.push({
      action: 'UPSERT',
      name: apex,
      type: 'TXT',
      ttl,
      values: desiredTxt.map(formatTxt),
      purpose: 'apex-txt',
    });

    if (mx.length > 0) {
      changes.push({
        action: 'UPSERT',
        name: apex,
        type: 'MX',
        ttl,
        values: mx.map((record) => formatMx(record.priority ?? 10, record.value)),
        purpose: 'mx',
      });
    }
  }

  for (const record of input.records) {
    if (record.purpose === 'verification' || record.purpose === 'spf' || record.purpose === 'mx') {
      continue;
    }
    const name = fqdn(record.name, input.zoneDomain);
    if (record.purpose === 'dmarc') {
      const existing = existingByKey.get(`${normalizeName(name)}|TXT`);
      const existingDmarc = existing?.values.map(unquoteTxt).find((v) => v.startsWith('v=DMARC1'));
      if (existingDmarc && existingDmarc !== record.value && !input.forceDmarc) {
        skipped.push(
          `DMARC on ${name} differs from Forward Email; skipped (pass --force-dmarc to overwrite).`,
        );
        continue;
      }
      changes.push({
        action: 'UPSERT',
        name,
        type: 'TXT',
        ttl,
        values: [formatTxt(record.value)],
        purpose: 'dmarc',
      });
      continue;
    }
    if (record.type === 'CNAME') {
      changes.push({
        action: 'UPSERT',
        name,
        type: 'CNAME',
        ttl,
        values: [formatCname(record.value)],
        purpose: record.purpose,
      });
      continue;
    }
    changes.push({
      action: 'UPSERT',
      name,
      type: 'TXT',
      ttl,
      values: [formatTxt(record.value)],
      purpose: record.purpose,
    });
  }

  return { apexCnameConflict: skipApex, skipped, changes };
}

function relativeName(domain: string, zoneDomain: string): string {
  if (domain === zoneDomain) return '@';
  return domain.slice(0, -(zoneDomain.length + 1));
}

function normalizeName(name: string): string {
  return name.replace(/\.$/, '').toLowerCase();
}

function unquoteTxt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
