import { lookup, resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

import type { DmarcPolicy } from '../contact/transactional-email-auth-profile';

export type ValidationStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface EmailDomainBrandingValidationCheck {
  id:
    'config' | 'spf' | 'dkim' | 'dmarc' | 'bimi-record' | 'bimi-logo-https' | 'bimi-svg-structure';
  status: ValidationStatus;
  message: string;
}

export interface EmailDomainBrandingValidationReport {
  ok: boolean;
  checks: EmailDomainBrandingValidationCheck[];
  errors: string[];
  warnings: string[];
}

export interface EmailDomainBrandingValidationConfig {
  domain: string;
  dkimSelector: string;
  expectedDmarcPolicy: DmarcPolicy;
  bimiSelector?: string;
  expectedBimiLogoUrl?: string;
  requireBimiSvg?: boolean;
}

export interface EmailDomainBrandingValidationDependencies {
  dnsResolveTxt?: (hostname: string) => Promise<string[]>;
  dnsLookupHost?: (hostname: string) => Promise<HostLookupResult>;
  fetchImpl?: typeof undiciFetch;
}

export interface HostLookupResult {
  addresses: string[];
  lookupFailed: boolean;
}

interface ParsedBimiRecord {
  locationUrl: string | null;
}

export interface SafeBimiLogoTarget {
  hostname: string;
  port: number;
  pinnedAddress: string;
}

type DnsLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

const DEFAULT_BIMI_SELECTOR = 'default';
const BIMI_LOGO_FETCH_TIMEOUT_MS = 10_000;
const BIMI_LOGO_MAX_BYTES = 512 * 1024;

export async function validateEmailDomainBranding(
  config: EmailDomainBrandingValidationConfig,
  deps: EmailDomainBrandingValidationDependencies = {},
): Promise<EmailDomainBrandingValidationReport> {
  const checks: EmailDomainBrandingValidationCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const dns = deps.dnsResolveTxt ?? resolveTxtFlat;
  const dnsLookupHost = deps.dnsLookupHost ?? lookupHostAddresses;
  const fetchImpl = deps.fetchImpl ?? undiciFetch;

  const configError = validateConfig(config);
  if (configError) {
    pushFail(checks, errors, 'config', configError);
    return { ok: false, checks, errors, warnings };
  }
  pushPass(checks, 'config', 'Configuration values are present and internally consistent.');

  const domain = config.domain.trim().toLowerCase();
  const dkimName = `${config.dkimSelector.trim().toLowerCase()}._domainkey.${domain}`;
  const dmarcName = `_dmarc.${domain}`;
  const bimiSelector = (config.bimiSelector ?? DEFAULT_BIMI_SELECTOR).trim().toLowerCase();
  const bimiName = `${bimiSelector}._bimi.${domain}`;

  const spfLookup = await lookupTxtRecords(dns, domain);
  if (spfLookup.lookupFailed) {
    pushFail(checks, errors, 'spf', dnsLookupFailureMessage(domain));
  } else {
    const spfMatches = spfLookup.records.filter((record) => /^v=spf1\b/i.test(record));
    if (spfMatches.length === 0) {
      pushFail(
        checks,
        errors,
        'spf',
        `No SPF TXT record found on ${domain}. Add a TXT record like "v=spf1 include:spf.forwardemail.net -all".`,
      );
    } else if (spfMatches.length > 1) {
      pushFail(
        checks,
        errors,
        'spf',
        `Multiple SPF TXT records found on ${domain} (${spfMatches.length}). SPF permits exactly one record.`,
      );
    } else if (/\s\+all\s*$/i.test(spfMatches[0])) {
      pushFail(
        checks,
        errors,
        'spf',
        `SPF record on ${domain} ends with +all, which authorizes every sender: ${spfMatches[0]}`,
      );
    } else if (!/\s(?:-all|~all|\?all)\s*$/i.test(spfMatches[0])) {
      pushWarn(
        checks,
        warnings,
        'spf',
        `SPF record on ${domain} does not end with an explicit all-mechanism (-all/~all/?all): ${spfMatches[0]}`,
      );
    } else {
      pushPass(checks, 'spf', `SPF TXT record found on ${domain}.`);
    }
  }

  const dkimLookup = await lookupTxtRecords(dns, dkimName);
  if (dkimLookup.lookupFailed) {
    pushFail(checks, errors, 'dkim', dnsLookupFailureMessage(dkimName));
  } else if (!dkimLookup.records.some((record) => /v=dkim1/i.test(record))) {
    pushFail(
      checks,
      errors,
      'dkim',
      `No DKIM TXT record with "v=DKIM1" found on ${dkimName}. Check the selector and DNS propagation.`,
    );
  } else {
    pushPass(checks, 'dkim', `DKIM TXT record found on ${dkimName}.`);
  }

  const dmarcLookup = await lookupTxtRecords(dns, dmarcName);
  if (dmarcLookup.lookupFailed) {
    pushFail(checks, errors, 'dmarc', dnsLookupFailureMessage(dmarcName));
  } else {
    const dmarc = dmarcLookup.records.find((record) => /^v=dmarc1\b/i.test(record));
    if (!dmarc) {
      pushFail(
        checks,
        errors,
        'dmarc',
        `No DMARC TXT record found on ${dmarcName}. Add a record with "v=DMARC1; p=${config.expectedDmarcPolicy}; ...".`,
      );
    } else {
      const policyMatch = dmarc.match(/(?:^|;)\s*p\s*=\s*([a-z]+)/i)?.[1]?.toLowerCase();
      const pct = parseDmarcPct(dmarc);
      if (pct === 'invalid') {
        pushFail(
          checks,
          errors,
          'dmarc',
          `DMARC pct tag is malformed on ${dmarcName}. Use an integer from 0 to 100, or omit pct for full enforcement.`,
        );
      } else if (policyMatch !== config.expectedDmarcPolicy) {
        pushFail(
          checks,
          errors,
          'dmarc',
          `DMARC policy mismatch on ${dmarcName}: expected p=${config.expectedDmarcPolicy}, got p=${policyMatch ?? 'missing'}.`,
        );
      } else if (pct !== null && pct !== 100) {
        pushFail(
          checks,
          errors,
          'dmarc',
          `DMARC pct=${pct} on ${dmarcName} does not enforce the full policy. Use pct=100 or omit pct.`,
        );
      } else {
        pushPass(checks, 'dmarc', `DMARC TXT record found with p=${config.expectedDmarcPolicy}.`);
      }
    }
  }

  const bimiLookup = await lookupTxtRecords(dns, bimiName);
  let bimiLogoUrl: string | null = null;

  if (bimiLookup.lookupFailed) {
    pushFail(checks, errors, 'bimi-record', dnsLookupFailureMessage(bimiName));
  } else {
    const bimi = bimiLookup.records.find((record) => /^v=bimi1\b/i.test(record));
    if (!bimi) {
      pushFail(
        checks,
        errors,
        'bimi-record',
        `No BIMI TXT record found on ${bimiName}. Add a record like "v=BIMI1; l=https://.../logo.svg;".`,
      );
    } else {
      const parsed = parseBimiRecord(bimi);
      bimiLogoUrl = parsed.locationUrl;
      if (!parsed.locationUrl) {
        pushFail(
          checks,
          errors,
          'bimi-record',
          `BIMI TXT record on ${bimiName} is missing the l= logo URL: ${bimi}`,
        );
      } else if (config.expectedBimiLogoUrl && parsed.locationUrl !== config.expectedBimiLogoUrl) {
        pushFail(
          checks,
          errors,
          'bimi-record',
          `BIMI logo URL mismatch on ${bimiName}: expected ${config.expectedBimiLogoUrl}, got ${parsed.locationUrl}.`,
        );
      } else {
        pushPass(checks, 'bimi-record', `BIMI TXT record found on ${bimiName}.`);
      }
    }
  }

  if (!bimiLogoUrl) {
    pushSkip(
      checks,
      'bimi-logo-https',
      'Skipped logo availability check because no BIMI l= URL could be determined.',
    );
    pushSkip(
      checks,
      'bimi-svg-structure',
      'Skipped SVG structure check because no BIMI l= URL could be determined.',
    );
    return { ok: errors.length === 0, checks, errors, warnings };
  }

  if (!bimiLogoUrl.startsWith('https://')) {
    pushFail(
      checks,
      errors,
      'bimi-logo-https',
      `BIMI logo URL must use HTTPS, got: ${bimiLogoUrl}`,
    );
    pushSkip(
      checks,
      'bimi-svg-structure',
      'Skipped SVG structure check because BIMI logo URL is not HTTPS.',
    );
    return { ok: errors.length === 0, checks, errors, warnings };
  }

  let svgText: string;
  try {
    svgText = await fetchBimiLogoSvg(bimiLogoUrl, fetchImpl, dnsLookupHost);
    pushPass(checks, 'bimi-logo-https', `BIMI logo URL responded successfully: ${bimiLogoUrl}`);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'BIMI logo could not be downloaded due to a network error.';
    pushFail(checks, errors, 'bimi-logo-https', message);
    pushSkip(
      checks,
      'bimi-svg-structure',
      'Skipped SVG structure check because BIMI logo could not be downloaded.',
    );
    return { ok: errors.length === 0, checks, errors, warnings };
  }

  const svgIssues = validateBimiSvgStructure(svgText);
  if (svgIssues.length > 0) {
    const message = `BIMI SVG structure validation failed: ${svgIssues.join(' ')}`;
    if (config.requireBimiSvg ?? true) {
      pushFail(checks, errors, 'bimi-svg-structure', message);
    } else {
      pushWarn(checks, warnings, 'bimi-svg-structure', message);
    }
  } else {
    pushPass(checks, 'bimi-svg-structure', 'BIMI SVG passed structural checks.');
  }

  return { ok: errors.length === 0, checks, errors, warnings };
}

export function validateBimiSvgStructure(svgText: string): string[] {
  const issues: string[] = [];
  const normalized = svgText.trim();

  if (!/<svg[\s>]/i.test(normalized)) {
    issues.push('Missing <svg> root element.');
    return issues;
  }

  const svgRootMatch = normalized.match(/<svg\b[^>]*>/i);
  const svgRoot = svgRootMatch?.[0] ?? '';
  if (!/\bbaseProfile\s*=\s*["']tiny-ps["']/i.test(svgRoot)) {
    issues.push('Root <svg> is missing baseProfile="tiny-ps".');
  }
  if (!/\bversion\s*=\s*["']1\.2["']/i.test(svgRoot)) {
    issues.push('Root <svg> is missing version="1.2".');
  }
  if (/<script\b/i.test(normalized)) {
    issues.push('SVG contains <script>, which is not allowed for BIMI.');
  }
  if (/\b(?:xlink:href|href)\s*=\s*["']https?:\/\//i.test(normalized)) {
    issues.push('SVG references an external HTTP(S) asset; BIMI SVG should be self-contained.');
  }

  return issues;
}

async function resolveTxtFlat(hostname: string): Promise<string[]> {
  const rows = await resolveTxt(hostname);
  return rows.map((segments) => segments.join(''));
}

async function lookupTxtRecords(
  dnsResolveTxt: (hostname: string) => Promise<string[]>,
  hostname: string,
): Promise<{ records: string[]; lookupFailed: boolean }> {
  try {
    const values = await dnsResolveTxt(hostname);
    return {
      records: values.map((value) => value.trim()).filter(Boolean),
      lookupFailed: false,
    };
  } catch {
    return { records: [], lookupFailed: true };
  }
}

function dnsLookupFailureMessage(hostname: string): string {
  return `DNS lookup failed for ${hostname}. Check resolver connectivity and retry; this is distinct from a missing TXT record.`;
}

function parseBimiRecord(value: string): ParsedBimiRecord {
  const rawLocationUrl = value.match(/(?:^|;)\s*l\s*=\s*([^;]+)/i)?.[1] ?? null;
  const locationUrl = rawLocationUrl === null ? null : rawLocationUrl.trim().replace(/^"|"$/g, '');
  return { locationUrl };
}

function parseDmarcPct(dmarc: string): number | null | 'invalid' {
  const match = dmarc.match(/(?:^|;)\s*pct\s*=\s*(\d+)/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return 'invalid';
  }
  return value;
}

async function fetchBimiLogoSvg(
  bimiLogoUrl: string,
  fetchImpl: typeof undiciFetch,
  dnsLookupHost: (hostname: string) => Promise<HostLookupResult>,
): Promise<string> {
  const target = await assertSafeBimiLogoUrl(bimiLogoUrl, dnsLookupHost);
  const dispatcher = createPinnedBimiLogoFetchDispatcher(target);

  try {
    const response = await fetchImpl(bimiLogoUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(BIMI_LOGO_FETCH_TIMEOUT_MS),
      dispatcher,
    });
    if (!response.ok) {
      throw new Error(
        `BIMI logo URL returned HTTP ${response.status} ${response.statusText}. URL: ${bimiLogoUrl}`,
      );
    }

    return readResponseTextWithLimit(response as Response, BIMI_LOGO_MAX_BYTES);
  } finally {
    dispatcher.destroy();
  }
}

async function assertSafeBimiLogoUrl(
  bimiLogoUrl: string,
  dnsLookupHost: (hostname: string) => Promise<HostLookupResult>,
): Promise<SafeBimiLogoTarget> {
  let parsed: URL;
  try {
    parsed = new URL(bimiLogoUrl);
  } catch {
    throw new Error(`Invalid BIMI logo URL: ${bimiLogoUrl}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`BIMI logo URL must use HTTPS, got: ${bimiLogoUrl}`);
  }

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (isUnsafeHostname(hostname)) {
    throw new Error(`BIMI logo URL targets an unsafe destination: ${hostname}`);
  }

  const hostLookup = await dnsLookupHost(hostname);
  if (hostLookup.lookupFailed) {
    throw new Error(dnsLookupFailureMessage(hostname));
  }
  if (hostLookup.addresses.length === 0) {
    throw new Error(`BIMI logo URL hostname could not be resolved: ${hostname}`);
  }

  for (const address of hostLookup.addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`BIMI logo URL resolves to a private address: ${address}`);
    }
  }

  return {
    hostname,
    port: parsed.port ? Number(parsed.port) : 443,
    pinnedAddress: hostLookup.addresses[0],
  };
}

export function createPinnedBimiLogoLookup(
  pinnedAddress: string,
): (hostname: string, options: unknown, callback: DnsLookupCallback) => void {
  const ipVersion = isIP(pinnedAddress);
  if (ipVersion === 0) {
    throw new Error(`Pinned BIMI logo address is not a valid IP: ${pinnedAddress}`);
  }

  return (_hostname, _options, callback) => {
    callback(null, pinnedAddress, ipVersion === 6 ? 6 : 4);
  };
}

export function createPinnedBimiLogoFetchDispatcher(target: SafeBimiLogoTarget): Agent {
  return new Agent({
    connect: {
      servername: target.hostname,
      lookup: createPinnedBimiLogoLookup(target.pinnedAddress),
    },
  });
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new Error(`BIMI logo response exceeds ${maxBytes} bytes.`);
  }

  const body = response.body;
  if (!body) {
    return response.text();
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`BIMI logo response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}

async function lookupHostAddresses(hostname: string): Promise<HostLookupResult> {
  try {
    const results = await lookup(hostname, { all: true });
    return {
      addresses: results.map((result) => result.address),
      lookupFailed: false,
    };
  } catch {
    return { addresses: [], lookupFailed: true };
  }
}

function isUnsafeHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower.endsWith('.local')) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4 || ipVersion === 6) {
    return isPrivateAddress(hostname);
  }

  return false;
}

function isPrivateAddress(address: string): boolean {
  const mappedIpv4 = unwrapIPv4MappedAddress(address);
  if (mappedIpv4 !== null) {
    return isPrivateAddress(mappedIpv4);
  }

  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    const octets = address.split('.').map(Number);
    const [a, b, c] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (isNonGlobalIPv4(a, b, c)) return true;
    return false;
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (isLinkLocalIPv6(normalized)) return true;
    if (isMulticastIPv6(normalized)) return true;
    if (isDocumentationIPv6(normalized)) return true;
  }

  return false;
}

function unwrapIPv4MappedAddress(address: string): string | null {
  if (isIP(address) !== 6) return null;

  const lower = address.toLowerCase();
  const dottedMatch = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch && isIP(dottedMatch[1]) === 4) {
    return dottedMatch[1];
  }

  const compatMatch = lower.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (compatMatch && isIP(compatMatch[1]) === 4) {
    return compatMatch[1];
  }

  const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    const mapped = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }

  return null;
}

function isNonGlobalIPv4(a: number, b: number, c: number): boolean {
  if (a >= 224 && a <= 239) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isDocumentationIPv6(address: string): boolean {
  const firstHextet = parseIPv6FirstHextet(address);
  const secondHextet = parseIPv6SecondHextet(address);
  return firstHextet === 0x2001 && secondHextet === 0xdb8;
}

function isLinkLocalIPv6(address: string): boolean {
  const firstHextet = parseIPv6FirstHextet(address);
  return firstHextet !== null && firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
}

function isMulticastIPv6(address: string): boolean {
  const firstHextet = parseIPv6FirstHextet(address);
  return firstHextet !== null && (firstHextet & 0xff00) === 0xff00;
}

function parseIPv6FirstHextet(address: string): number | null {
  if (isIP(address) !== 6) return null;

  const lower = address.toLowerCase();
  if (lower.includes('::')) {
    const [head] = lower.split('::');
    const headPart = head.split(':')[0];
    if (headPart) {
      return parseInt(headPart, 16);
    }
    return 0;
  }

  const [firstPart] = lower.split(':');
  return parseInt(firstPart, 16);
}

function parseIPv6SecondHextet(address: string): number | null {
  if (isIP(address) !== 6) return null;

  const lower = address.toLowerCase();
  if (lower.includes('::')) {
    const [head] = lower.split('::');
    const headParts = head.split(':').filter(Boolean);
    if (headParts.length >= 2) {
      return parseInt(headParts[1], 16);
    }
    return null;
  }

  const parts = lower.split(':');
  if (parts.length < 2 || !parts[1]) return null;
  return parseInt(parts[1], 16);
}

function validateConfig(config: EmailDomainBrandingValidationConfig): string | null {
  if (!config.domain?.trim()) return 'Missing required configuration: domain.';
  if (!config.dkimSelector?.trim()) return 'Missing required configuration: dkimSelector.';
  if (!/^[a-z0-9.-]+$/i.test(config.domain)) {
    return `Invalid domain value "${config.domain}".`;
  }
  if (!['quarantine', 'reject'].includes(config.expectedDmarcPolicy)) {
    return 'expectedDmarcPolicy must be one of: quarantine, reject.';
  }
  if (config.expectedBimiLogoUrl && !/^https?:\/\//i.test(config.expectedBimiLogoUrl)) {
    return `expectedBimiLogoUrl must be absolute (http/https), got "${config.expectedBimiLogoUrl}".`;
  }
  return null;
}

function pushPass(
  checks: EmailDomainBrandingValidationCheck[],
  id: EmailDomainBrandingValidationCheck['id'],
  message: string,
): void {
  checks.push({ id, status: 'pass', message });
}

function pushFail(
  checks: EmailDomainBrandingValidationCheck[],
  errors: string[],
  id: EmailDomainBrandingValidationCheck['id'],
  message: string,
): void {
  checks.push({ id, status: 'fail', message });
  errors.push(message);
}

function pushWarn(
  checks: EmailDomainBrandingValidationCheck[],
  warnings: string[],
  id: EmailDomainBrandingValidationCheck['id'],
  message: string,
): void {
  checks.push({ id, status: 'warn', message });
  warnings.push(message);
}

function pushSkip(
  checks: EmailDomainBrandingValidationCheck[],
  id: EmailDomainBrandingValidationCheck['id'],
  message: string,
): void {
  checks.push({ id, status: 'skip', message });
}
