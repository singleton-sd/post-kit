import { readFileSync } from 'node:fs';

export interface EmailDomainAliasConfig {
  name: string;
  recipients: string[];
}

export interface EmailDomainConfig {
  domain: string;
  zoneDomain: string;
  hostedZoneId?: string;
  aliases: EmailDomainAliasConfig[];
}

export interface EmailDomainsFile {
  version: 1;
  domains: EmailDomainConfig[];
}

export function parseEmailDomainsFile(raw: string): EmailDomainsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('email-domains.json is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('email-domains.json must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('email-domains.json version must be 1');
  }
  if (!Array.isArray(record.domains) || record.domains.length === 0) {
    throw new Error('email-domains.json domains must be a non-empty array');
  }
  const domains = record.domains.map((item, index) => parseDomain(item, index));
  return { version: 1, domains };
}

export function loadEmailDomainsFile(path: string): EmailDomainsFile {
  return parseEmailDomainsFile(readFileSync(path, 'utf8'));
}

function parseDomain(item: unknown, index: number): EmailDomainConfig {
  if (!item || typeof item !== 'object') {
    throw new Error(`email-domains.json domains[${index}] must be an object`);
  }
  const record = item as Record<string, unknown>;
  const domain = requiredString(record.domain, `domains[${index}].domain`);
  const zoneDomain = requiredString(record.zoneDomain, `domains[${index}].zoneDomain`);
  if (domain !== zoneDomain && !domain.endsWith(`.${zoneDomain}`)) {
    throw new Error(`domains[${index}].domain ${domain} is not under ${zoneDomain}`);
  }
  const hostedZoneId =
    typeof record.hostedZoneId === 'string' && record.hostedZoneId.trim()
      ? record.hostedZoneId.trim()
      : undefined;
  if (!Array.isArray(record.aliases)) {
    throw new Error(`domains[${index}].aliases must be an array`);
  }
  const aliases = record.aliases.map((alias, aliasIndex) =>
    parseAlias(alias, `domains[${index}].aliases[${aliasIndex}]`),
  );
  return { domain, zoneDomain, hostedZoneId, aliases };
}

function parseAlias(item: unknown, label: string): EmailDomainAliasConfig {
  if (!item || typeof item !== 'object') {
    throw new Error(`${label} must be an object`);
  }
  const record = item as Record<string, unknown>;
  const name = requiredString(record.name, `${label}.name`);
  if (!Array.isArray(record.recipients) || record.recipients.length === 0) {
    throw new Error(`${label}.recipients must be a non-empty array`);
  }
  const recipients = record.recipients.map((value, i) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label}.recipients[${i}] must be a non-empty string`);
    }
    return value.trim();
  });
  return { name, recipients };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}
