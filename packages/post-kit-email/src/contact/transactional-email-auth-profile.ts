export type DmarcPolicy = 'quarantine' | 'reject';

export interface TransactionalEmailAuthProfile {
  fromAddress: string;
  fromName: string;
  sendingDomain: string;
  dkimSelector: string;
  dmarcPolicy: DmarcPolicy;
  dmarcAggregateReportAddress: string;
}

export function loadTransactionalEmailAuthProfile(
  env: NodeJS.ProcessEnv = process.env,
): TransactionalEmailAuthProfile {
  const fromAddress = (env.EMAIL_FROM_ADDRESS ?? env.CONTACT_FROM_EMAIL ?? '').trim();
  const fromName = (env.EMAIL_FROM_NAME ?? env.EMAIL_BRAND_NAME ?? 'Transactional Email').trim();
  const sendingDomain = (env.EMAIL_SENDING_DOMAIN ?? extractEmailDomain(fromAddress) ?? '')
    .trim()
    .toLowerCase();
  const dkimSelector = (env.EMAIL_DKIM_SELECTOR ?? 'fe').trim();
  const dmarcPolicy = normalizeDmarcPolicy(env.EMAIL_DMARC_POLICY);
  const dmarcAggregateReportAddress = (env.EMAIL_DMARC_RUA ?? '').trim();

  return {
    fromAddress,
    fromName,
    sendingDomain,
    dkimSelector,
    dmarcPolicy,
    dmarcAggregateReportAddress,
  };
}

export function validateTransactionalEmailAuthProfile(
  profile: TransactionalEmailAuthProfile,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const errors: string[] = [];

  if (!profile.fromAddress) {
    errors.push('EMAIL_FROM_ADDRESS is required');
  }
  if (!profile.sendingDomain) {
    errors.push('EMAIL_SENDING_DOMAIN is required (or derive it from EMAIL_FROM_ADDRESS)');
  }

  errors.push(...validateDmarcPolicyEnv(env.EMAIL_DMARC_POLICY));

  const fromDomain = extractEmailDomain(profile.fromAddress);
  if (profile.sendingDomain && fromDomain && !isDomainAligned(fromDomain, profile.sendingDomain)) {
    errors.push(
      `EMAIL_FROM_ADDRESS (${fromDomain}) must align with EMAIL_SENDING_DOMAIN (${profile.sendingDomain})`,
    );
  }

  errors.push(...validateDmarcAggregateReportAddress(profile.dmarcAggregateReportAddress));

  return errors;
}

/** Validate a resolved sender address against the configured sending domain. */
export function validateResolvedSenderDomainAlignment(
  fromAddress: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const authProfile = loadTransactionalEmailAuthProfile(env);
  const errors = validateTransactionalEmailAuthProfile(authProfile, env);
  if (errors.length > 0) {
    return errors;
  }

  const fromDomain = extractEmailDomain(fromAddress);
  if (
    authProfile.sendingDomain &&
    fromDomain &&
    !isDomainAligned(fromDomain, authProfile.sendingDomain)
  ) {
    return [
      `Resolved fromAddress (${fromDomain}) must align with EMAIL_SENDING_DOMAIN (${authProfile.sendingDomain})`,
    ];
  }

  return [];
}

export function extractEmailDomain(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return null;
  return address
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

function normalizeDmarcPolicy(value: string | undefined): DmarcPolicy {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'reject') {
    return 'reject';
  }
  return 'quarantine';
}

function validateDmarcPolicyEnv(value: string | undefined): string[] {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  if (normalized === 'none') {
    return ['EMAIL_DMARC_POLICY must be quarantine or reject (none is not allowed)'];
  }
  if (normalized !== 'quarantine' && normalized !== 'reject') {
    return [`EMAIL_DMARC_POLICY must be quarantine or reject (got "${value}")`];
  }
  return [];
}

function validateDmarcAggregateReportAddress(value: string): string[] {
  if (!value) {
    return [];
  }

  const errors: string[] = [];
  const parts = value.split(',');
  for (const part of parts) {
    const entry = part.trim();
    if (!entry) {
      errors.push('EMAIL_DMARC_RUA must not contain empty comma-separated entries');
      return errors;
    }
    if (!entry.toLowerCase().startsWith('mailto:')) {
      errors.push(`EMAIL_DMARC_RUA entry must start with "mailto:" (${entry})`);
      continue;
    }
    const recipient = entry.slice('mailto:'.length).trim();
    if (!recipient || !recipient.includes('@')) {
      errors.push(`EMAIL_DMARC_RUA mailto entry must include a recipient (${entry})`);
    }
  }
  return errors;
}

function isDomainAligned(fromDomain: string, sendingDomain: string): boolean {
  return fromDomain === sendingDomain || fromDomain.endsWith(`.${sendingDomain}`);
}
