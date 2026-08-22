import { EmailProviderError } from '../providers/email-types';
import { loadEmailRuntimeConfig } from '../providers/create-email-provider';

export type ContactEmailProfile = {
  fromAddress: string;
  fromName: string;
  contactInboxAddress: string;
};

/** Optional sender fields from tenant/PoC `settings.email`. */
export type TenantEmailProfileOverride = Partial<ContactEmailProfile>;

const EMAIL_RE = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

type HostProfileMap = Record<string, TenantEmailProfileOverride>;

type HostProfileCacheEntry = {
  raw: string;
  providerName: 'forward-email' | 'development';
  value: HostProfileMap;
};

/** Module-level cache: same env JSON is not re-parsed on every contact submit. */
let hostProfileCache: HostProfileCacheEntry | null = null;

/** Type guard for plain object records parsed from JSON or tenant settings. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Build a configuration-scoped EmailProviderError for profile parsing failures. */
function configurationError(
  message: string,
  providerName: 'forward-email' | 'development',
): EmailProviderError {
  return new EmailProviderError({
    message,
    kind: 'configuration',
    provider: providerName,
  });
}

/** Parse an optional override field; reject present but invalid values. */
function parseOptionalProfileString(
  value: unknown,
  fieldPath: string,
  providerName: 'forward-email' | 'development',
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw configurationError(`${fieldPath} must be a string when provided`, providerName);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw configurationError(`${fieldPath} must be a non-empty string when provided`, providerName);
  }
  return trimmed;
}

/** Validate an email address or throw a configuration error. */
function assertEmail(
  value: string,
  field: string,
  providerName: 'forward-email' | 'development',
): string {
  if (!EMAIL_RE.test(value)) {
    throw configurationError(`${field} must be a valid email address`, providerName);
  }
  return value;
}

/** Parse optional sender override fields from a host map entry or tenant settings.email object. */
function parseProfileOverrideFields(
  profile: Record<string, unknown>,
  fieldPrefix: string,
  providerName: 'forward-email' | 'development',
): TenantEmailProfileOverride {
  return {
    fromAddress: parseOptionalProfileString(
      profile.fromAddress,
      `${fieldPrefix}.fromAddress`,
      providerName,
    ),
    fromName: parseOptionalProfileString(profile.fromName, `${fieldPrefix}.fromName`, providerName),
    contactInboxAddress: parseOptionalProfileString(
      profile.contactInboxAddress,
      `${fieldPrefix}.contactInboxAddress`,
      providerName,
    ),
  };
}

/** Merge non-empty override fields into a resolved contact email profile. */
function applyProfileOverride(
  resolved: ContactEmailProfile,
  override: TenantEmailProfileOverride | undefined,
): void {
  if (override?.fromAddress) resolved.fromAddress = override.fromAddress;
  if (override?.fromName) resolved.fromName = override.fromName;
  if (override?.contactInboxAddress) {
    resolved.contactInboxAddress = override.contactInboxAddress;
  }
}

/** Parse and validate `CONTACT_EMAIL_PROFILES_BY_HOST` JSON into a host-keyed override map. */
function parseHostProfileMap(
  raw: string | undefined,
  providerName: 'forward-email' | 'development',
): HostProfileMap {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configurationError('CONTACT_EMAIL_PROFILES_BY_HOST must be valid JSON', providerName);
  }
  if (!isRecord(parsed)) {
    throw configurationError(
      'CONTACT_EMAIL_PROFILES_BY_HOST must be an object map by host',
      providerName,
    );
  }

  const out: HostProfileMap = {};
  for (const [host, profile] of Object.entries(parsed)) {
    if (!isRecord(profile)) {
      throw configurationError(
        `CONTACT_EMAIL_PROFILES_BY_HOST["${host}"] must be an object`,
        providerName,
      );
    }
    const parsedProfile = parseProfileOverrideFields(
      profile,
      `CONTACT_EMAIL_PROFILES_BY_HOST["${host}"]`,
      providerName,
    );
    if (
      !parsedProfile.fromAddress &&
      !parsedProfile.fromName &&
      !parsedProfile.contactInboxAddress
    ) {
      throw configurationError(
        `CONTACT_EMAIL_PROFILES_BY_HOST["${host}"] must include at least one sender field`,
        providerName,
      );
    }
    out[host.toLowerCase()] = parsedProfile;
  }
  return out;
}

/** Cached parse of `CONTACT_EMAIL_PROFILES_BY_HOST` (keyed by raw JSON + provider). */
export function getHostProfileMap(
  raw: string | undefined,
  providerName: 'forward-email' | 'development',
): HostProfileMap {
  const cacheKey = raw ?? '';
  if (
    hostProfileCache &&
    hostProfileCache.raw === cacheKey &&
    hostProfileCache.providerName === providerName
  ) {
    return hostProfileCache.value;
  }
  const value = parseHostProfileMap(raw, providerName);
  hostProfileCache = { raw: cacheKey, providerName, value };
  return value;
}

/** Test/helper: drop the memoized host map (e.g. after mutating process.env in tests). */
export function clearHostProfileMapCache(): void {
  hostProfileCache = null;
}

/**
 * Shared parser for tenant/PoC `settings.email` sender overrides.
 * Returns `undefined` when no usable email fields are present.
 */
export function resolveTenantEmailProfileOverride(
  settings: Record<string, unknown> | null | undefined,
  providerName: 'forward-email' | 'development' = 'forward-email',
): TenantEmailProfileOverride | undefined {
  if (!settings || !isRecord(settings.email)) return undefined;
  const parsed = parseProfileOverrideFields(settings.email, 'settings.email', providerName);
  if (!parsed.fromAddress && !parsed.fromName && !parsed.contactInboxAddress) return undefined;
  return parsed;
}

/**
 * Resolve the contact inquiry sender profile with precedence:
 * global env defaults, tenant settings.email, trusted host map, then explicit overrides.
 */
export function resolveContactEmailProfile(
  options: {
    env?: NodeJS.ProcessEnv;
    tenantSettings?: Record<string, unknown> | null;
    /** Pre-validated host from an allowlist (never raw client Origin). */
    trustedRequestHost?: string | null;
    profileOverride?: Partial<ContactEmailProfile>;
  } = {},
): ContactEmailProfile {
  const env = options.env ?? process.env;
  const config = loadEmailRuntimeConfig(env);
  const providerName = config.provider;

  const resolved: ContactEmailProfile = {
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    contactInboxAddress: config.contactInboxAddress,
  };

  applyProfileOverride(
    resolved,
    resolveTenantEmailProfileOverride(options.tenantSettings, providerName),
  );

  const trustedHost = options.trustedRequestHost?.trim().toLowerCase();
  if (trustedHost) {
    const hostProfiles = getHostProfileMap(env.CONTACT_EMAIL_PROFILES_BY_HOST, providerName);
    applyProfileOverride(resolved, hostProfiles[trustedHost]);
  }

  if (options.profileOverride) {
    applyProfileOverride(
      resolved,
      parseProfileOverrideFields(
        options.profileOverride as Record<string, unknown>,
        'profileOverride',
        providerName,
      ),
    );
  }

  return {
    fromAddress: assertEmail(resolved.fromAddress, 'fromAddress', providerName),
    fromName: resolved.fromName,
    contactInboxAddress: assertEmail(
      resolved.contactInboxAddress,
      'contactInboxAddress',
      providerName,
    ),
  };
}
