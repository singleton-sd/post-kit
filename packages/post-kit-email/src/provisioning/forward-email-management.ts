/**
 * Forward Email management-API client used by deployment-time provisioning.
 * Runtime senders must not import Route53 helpers from here.
 */

export interface ForwardEmailDnsRecord {
  type: 'MX' | 'TXT' | 'CNAME';
  /** Relative name under the parent hosted zone (e.g. plattform-kit.poc). */
  name: string;
  value: string;
  priority?: number;
  purpose: 'verification' | 'mx' | 'spf' | 'dkim' | 'dmarc' | 'return-path';
  source: 'static' | 'api';
}

export interface ForwardEmailDomainSummary {
  id: string;
  name: string;
  plan?: string;
  verificationRecord?: string;
  hasMxRecord: boolean;
  hasTxtRecord: boolean;
  hasDkimRecord: boolean;
  hasReturnPathRecord: boolean;
  hasDmarcRecord: boolean;
  hasSpfRecord: boolean;
  smtpDnsRecords?: {
    dkim?: { name: string; value: string };
    return_path?: { name: string; value: string };
    dmarc?: { name: string; value: string };
  };
}

export interface ForwardEmailAliasSummary {
  id: string;
  name: string;
  recipients: string[];
}

type FetchLike = typeof fetch;

export interface ForwardEmailManagementClientOptions {
  apiToken?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

function resolveToken(explicit?: string): string {
  const token = (
    explicit ??
    process.env.FORWARD_EMAIL_TOKEN ??
    process.env.FORWARDEMAIL_API_KEY ??
    ''
  ).trim();
  if (!token) {
    throw new Error('FORWARD_EMAIL_TOKEN is not configured');
  }
  return token;
}

export class ForwardEmailManagementClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ForwardEmailManagementClientOptions = {}) {
    this.apiToken = resolveToken(options.apiToken);
    this.baseUrl = (
      options.baseUrl ??
      process.env.FORWARD_EMAIL_BASE_URL ??
      process.env.FORWARDEMAIL_BASE_URL ??
      'https://api.forwardemail.net'
    ).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.apiToken}:`, 'utf8').toString('base64')}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: URLSearchParams,
  ): Promise<{ status: number; data: T; rawText: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body,
    });
    const rawText = await response.text();
    let data = {} as T;
    if (rawText) {
      try {
        data = JSON.parse(rawText) as T;
      } catch {
        data = { message: rawText } as T;
      }
    }
    return { status: response.status, data, rawText };
  }

  async listDomains(): Promise<ForwardEmailDomainSummary[]> {
    const { status, data, rawText } = await this.request<unknown>(
      'GET',
      '/v1/domains?paginate=true&limit=50',
    );
    if (status >= 400) {
      throw new Error(`Forward Email list domains failed (${status})`);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!Array.isArray(data) && rawText) {
      throw new Error('Forward Email list domains returned unexpected payload');
    }
    return rows.map((row) => mapDomain(row as Record<string, unknown>));
  }

  async getDomain(domain: string): Promise<ForwardEmailDomainSummary | null> {
    const { status, data } = await this.request<Record<string, unknown>>(
      'GET',
      `/v1/domains/${encodeURIComponent(domain)}`,
    );
    if (status === 404) return null;
    if (status >= 400) {
      throw new Error(`Forward Email get domain failed (${status})`);
    }
    return mapDomain(data);
  }

  async ensureDomain(
    domain: string,
    plan = 'team',
  ): Promise<{
    domain: ForwardEmailDomainSummary;
    created: boolean;
  }> {
    const existing = await this.getDomain(domain);
    if (existing) return { domain: existing, created: false };

    const body = new URLSearchParams();
    body.set('domain', domain);
    body.set('plan', plan);
    const { status, data } = await this.request<Record<string, unknown>>(
      'POST',
      '/v1/domains',
      body,
    );
    if (status >= 400) {
      // Race: another runner created it.
      const again = await this.getDomain(domain);
      if (again) return { domain: again, created: false };
      throw new Error(`Forward Email create domain failed (${status})`);
    }
    return { domain: mapDomain(data), created: true };
  }

  async listAliases(domain: string): Promise<ForwardEmailAliasSummary[]> {
    const { status, data } = await this.request<unknown>(
      'GET',
      `/v1/domains/${encodeURIComponent(domain)}/aliases?pagination=true&limit=50`,
    );
    if (status >= 400) {
      throw new Error(`Forward Email list aliases failed (${status})`);
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      const recipients = Array.isArray(r.recipients)
        ? r.recipients.map(String)
        : typeof r.recipients === 'string'
          ? [r.recipients]
          : [];
      return {
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        recipients,
      };
    });
  }

  async ensureAlias(
    domain: string,
    aliasName: string,
    recipients: string[],
  ): Promise<{ alias: ForwardEmailAliasSummary; created: boolean }> {
    const existing = (await this.listAliases(domain)).find(
      (a) => a.name.toLowerCase() === aliasName.toLowerCase(),
    );
    if (existing) return { alias: existing, created: false };

    const body = new URLSearchParams();
    body.set('name', aliasName);
    for (const recipient of recipients) body.append('recipients', recipient);
    const { status, data } = await this.request<Record<string, unknown>>(
      'POST',
      `/v1/domains/${encodeURIComponent(domain)}/aliases`,
      body,
    );
    if (status >= 400) {
      const again = (await this.listAliases(domain)).find(
        (a) => a.name.toLowerCase() === aliasName.toLowerCase(),
      );
      if (again) return { alias: again, created: false };
      throw new Error(`Forward Email create alias failed (${status})`);
    }
    const recipientsOut = Array.isArray(data.recipients) ? data.recipients.map(String) : recipients;
    return {
      alias: {
        id: String(data.id ?? ''),
        name: String(data.name ?? aliasName),
        recipients: recipientsOut,
      },
      created: true,
    };
  }

  async verifyRecords(domain: string): Promise<{
    ok: boolean;
    status: number;
    message?: string;
  }> {
    const { status, data, rawText } = await this.request<{ message?: string }>(
      'GET',
      `/v1/domains/${encodeURIComponent(domain)}/verify-records`,
    );
    if (status >= 400) {
      return {
        ok: false,
        status,
        message: data.message ?? rawText,
      };
    }
    return { ok: true, status, message: data.message };
  }

  async verifySmtp(domain: string): Promise<{
    ok: boolean;
    status: number;
    message?: string;
  }> {
    const { status, data, rawText } = await this.request<{ message?: string }>(
      'GET',
      `/v1/domains/${encodeURIComponent(domain)}/verify-smtp`,
    );
    if (status >= 400) {
      return {
        ok: false,
        status,
        message: data.message ?? rawText,
      };
    }
    return { ok: true, status, message: data.message };
  }
}

function mapDomain(row: Record<string, unknown>): ForwardEmailDomainSummary {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    plan: row.plan ? String(row.plan) : undefined,
    verificationRecord: row.verification_record ? String(row.verification_record) : undefined,
    hasMxRecord: Boolean(row.has_mx_record),
    hasTxtRecord: Boolean(row.has_txt_record),
    hasDkimRecord: Boolean(row.has_dkim_record),
    hasReturnPathRecord: Boolean(row.has_return_path_record),
    hasDmarcRecord: Boolean(row.has_dmarc_record),
    hasSpfRecord: Boolean(row.has_spf_record),
    smtpDnsRecords: row.smtp_dns_records as ForwardEmailDomainSummary['smtpDnsRecords'],
  };
}

/**
 * Build the DNS set required for a sending subdomain under a parent zone.
 * Dynamic DKIM / DMARC / Return-Path values come from the Forward Email API.
 */
export function getRequiredDnsRecords(options: {
  domain: string;
  zoneDomain: string;
  verificationToken: string;
  smtpDnsRecords?: ForwardEmailDomainSummary['smtpDnsRecords'];
  existingSpf?: string | null;
}): ForwardEmailDnsRecord[] {
  const { domain, zoneDomain, verificationToken, smtpDnsRecords, existingSpf } = options;
  if (!domain.endsWith(`.${zoneDomain}`)) {
    throw new Error(`Domain ${domain} is not under zone ${zoneDomain}`);
  }
  const relative = domain.slice(0, -(zoneDomain.length + 1));

  const records: ForwardEmailDnsRecord[] = [
    {
      type: 'TXT',
      name: relative,
      value: `forward-email-site-verification=${verificationToken}`,
      purpose: 'verification',
      source: 'api',
    },
    {
      type: 'MX',
      name: relative,
      value: 'mx1.forwardemail.net',
      priority: 10,
      purpose: 'mx',
      source: 'static',
    },
    {
      type: 'MX',
      name: relative,
      value: 'mx2.forwardemail.net',
      priority: 20,
      purpose: 'mx',
      source: 'static',
    },
    {
      type: 'TXT',
      name: relative,
      value: mergeSpfInclude(existingSpf, 'spf.forwardemail.net'),
      purpose: 'spf',
      source: 'static',
    },
  ];

  if (smtpDnsRecords?.dkim?.name && smtpDnsRecords.dkim.value) {
    records.push({
      type: 'TXT',
      name: stripZoneSuffix(smtpDnsRecords.dkim.name, zoneDomain),
      value: smtpDnsRecords.dkim.value,
      purpose: 'dkim',
      source: 'api',
    });
  }
  if (smtpDnsRecords?.return_path?.name && smtpDnsRecords.return_path.value) {
    records.push({
      type: 'CNAME',
      name: stripZoneSuffix(smtpDnsRecords.return_path.name, zoneDomain),
      value: smtpDnsRecords.return_path.value.replace(/\.$/, ''),
      purpose: 'return-path',
      source: 'api',
    });
  }
  if (smtpDnsRecords?.dmarc?.name && smtpDnsRecords.dmarc.value) {
    records.push({
      type: 'TXT',
      name: stripZoneSuffix(smtpDnsRecords.dmarc.name, zoneDomain),
      value: smtpDnsRecords.dmarc.value,
      purpose: 'dmarc',
      source: 'api',
    });
  }

  return records;
}

export function mergeSpfInclude(
  existingSpf: string | null | undefined,
  includeHost: string,
): string {
  const include = `include:${includeHost}`;
  if (!existingSpf?.trim()) {
    return `v=spf1 ${include} -all`;
  }
  const trimmed = existingSpf.trim().replace(/^"|"$/g, '');
  if (!trimmed.toLowerCase().startsWith('v=spf1')) {
    return `v=spf1 ${include} -all`;
  }
  if (trimmed.includes(include)) return trimmed;
  if (/\s(-all|~all|\?all|\+all)\s*$/i.test(trimmed)) {
    return trimmed.replace(/\s(-all|~all|\?all|\+all)\s*$/i, ` ${include} $1`);
  }
  return `${trimmed} ${include} -all`;
}

function stripZoneSuffix(name: string, zoneDomain: string): string {
  const cleaned = name.replace(/\.$/, '');
  if (cleaned === zoneDomain) return '@';
  if (cleaned.endsWith(`.${zoneDomain}`)) {
    return cleaned.slice(0, -(zoneDomain.length + 1));
  }
  return cleaned;
}
