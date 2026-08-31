import {
  PostKitErrorCode,
  type TenantContext,
  type TenantEnvironment,
} from '@singleton-sd/post-kit-types';

/** Tenant-scoped sender and provider settings resolved server-side. */
export interface TenantEmailConfig {
  fromAddress: string;
  fromDisplayName?: string;
  replyTo?: string;
  providerAccount?: string;
}

/** Partial overrides stored in configuration for a tenant/environment. */
export type TenantEmailConfigOverride = Partial<
  Omit<TenantEmailConfig, 'fromAddress'> & { fromAddress?: string }
>;

/** Fully resolved sender identity used when dispatching email. */
export type ResolvedTenantEmailConfig = TenantEmailConfig & {
  /** Resolved provider API token when providerAccount is configured. Never log. */
  providerApiToken?: string;
};

type TenantEnvironmentMap = Partial<Record<TenantEnvironment, TenantEmailConfigOverride>>;
type TenantEmailConfigMap = Record<string, TenantEnvironmentMap>;

type ProviderAccountSecretMap = Record<string, string>;

type ConfigCache = {
  tenantConfigRaw: string;
  providerSecretsRaw: string;
  tenantConfig: TenantEmailConfigMap;
  providerSecrets: ProviderAccountSecretMap;
};

let cache: ConfigCache | null = null;

const EMAIL_RE = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

/**
 * Error thrown when tenant email configuration is missing or incomplete.
 * Never include provider credentials or account identifiers in messages.
 */
export class TenantEmailConfigError extends Error {
  readonly code: PostKitErrorCode;

  constructor(message: string, code: PostKitErrorCode = PostKitErrorCode.TENANT_CONFIG_NOT_FOUND) {
    super(message);
    this.name = 'TenantEmailConfigError';
    this.code = code;
  }
}

/** Test helper: drop memoized parsed configuration. */
export function clearTenantEmailConfigCache(): void {
  cache = null;
}

/**
 * Resolve tenant-scoped sender identity merged with platform defaults.
 *
 * Precedence (lowest first): platform `EMAIL_FROM_*` env vars, then the tenant's
 * configured override for the authenticated environment.
 */
export function resolveTenantEmailConfig(
  tenant: TenantContext,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedTenantEmailConfig {
  const { tenantConfig, providerSecrets } = loadConfigMaps(env);
  const tenantEntry = tenantConfig[tenant.tenantId];
  if (!tenantEntry) {
    throw new TenantEmailConfigError(
      `Email configuration is not defined for tenant "${tenant.tenantId}" in environment "${tenant.environment}".`,
    );
  }

  const override = tenantEntry[tenant.environment];
  if (!override) {
    throw new TenantEmailConfigError(
      `Email configuration is not defined for tenant "${tenant.tenantId}" in environment "${tenant.environment}".`,
    );
  }

  const fromAddress = (override.fromAddress ?? env.EMAIL_FROM_ADDRESS ?? '').trim();
  if (!fromAddress) {
    throw new TenantEmailConfigError(
      `Email sender is not configured for tenant "${tenant.tenantId}" in environment "${tenant.environment}".`,
    );
  }

  if (!EMAIL_RE.test(fromAddress)) {
    throw new TenantEmailConfigError(
      `Email sender address is invalid for tenant "${tenant.tenantId}" in environment "${tenant.environment}".`,
    );
  }

  const fromDisplayName = (override.fromDisplayName ?? env.EMAIL_FROM_NAME)?.trim() || undefined;
  const replyTo = override.replyTo?.trim() || undefined;
  if (replyTo && !EMAIL_RE.test(replyTo)) {
    throw new TenantEmailConfigError(
      `Reply-to address is invalid for tenant "${tenant.tenantId}" in environment "${tenant.environment}".`,
    );
  }

  const providerAccount = override.providerAccount?.trim() || undefined;
  const providerApiToken = providerAccount
    ? resolveProviderApiToken(providerAccount, providerSecrets, env)
    : undefined;

  return {
    fromAddress,
    fromDisplayName,
    replyTo,
    providerAccount,
    providerApiToken,
  };
}

function loadConfigMaps(env: NodeJS.ProcessEnv): {
  tenantConfig: TenantEmailConfigMap;
  providerSecrets: ProviderAccountSecretMap;
} {
  const tenantConfigRaw = env.TENANT_EMAIL_CONFIG_BY_ID ?? '';
  const providerSecretsRaw = env.TENANT_PROVIDER_ACCOUNT_SECRETS ?? '';

  if (
    cache &&
    cache.tenantConfigRaw === tenantConfigRaw &&
    cache.providerSecretsRaw === providerSecretsRaw
  ) {
    return {
      tenantConfig: cache.tenantConfig,
      providerSecrets: cache.providerSecrets,
    };
  }

  const tenantConfig = parseTenantConfigMap(tenantConfigRaw);
  const providerSecrets = parseProviderAccountSecretMap(providerSecretsRaw);
  cache = { tenantConfigRaw, providerSecretsRaw, tenantConfig, providerSecrets };
  return { tenantConfig, providerSecrets };
}

function parseTenantConfigMap(raw: string): TenantEmailConfigMap {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TenantEmailConfigError('Tenant email configuration is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new TenantEmailConfigError('Tenant email configuration must be a JSON object.');
  }

  const out: TenantEmailConfigMap = {};
  for (const [tenantId, environments] of Object.entries(parsed)) {
    if (!isRecord(environments)) {
      throw new TenantEmailConfigError(
        `Tenant email configuration for "${tenantId}" must be an object keyed by environment.`,
      );
    }
    const envMap: TenantEnvironmentMap = {};
    for (const [environment, config] of Object.entries(environments)) {
      if (!isTenantEnvironment(environment)) {
        throw new TenantEmailConfigError(
          `Tenant email configuration for "${tenantId}" contains an unknown environment "${environment}".`,
        );
      }
      if (!isRecord(config)) {
        throw new TenantEmailConfigError(
          `Tenant email configuration for "${tenantId}" / "${environment}" must be an object.`,
        );
      }
      envMap[environment] = parseOverride(config, tenantId, environment);
    }
    out[tenantId] = envMap;
  }
  return out;
}

function parseOverride(
  config: Record<string, unknown>,
  tenantId: string,
  environment: string,
): TenantEmailConfigOverride {
  const prefix = `Tenant email configuration for "${tenantId}" / "${environment}"`;
  const override: TenantEmailConfigOverride = {};

  if (config.fromAddress !== undefined) {
    override.fromAddress = parseOptionalString(config.fromAddress, `${prefix}.fromAddress`);
  }
  if (config.fromDisplayName !== undefined) {
    override.fromDisplayName = parseOptionalString(
      config.fromDisplayName,
      `${prefix}.fromDisplayName`,
    );
  }
  if (config.replyTo !== undefined) {
    override.replyTo = parseOptionalString(config.replyTo, `${prefix}.replyTo`);
  }
  if (config.providerAccount !== undefined) {
    override.providerAccount = parseOptionalString(
      config.providerAccount,
      `${prefix}.providerAccount`,
    );
  }

  return override;
}

function parseProviderAccountSecretMap(raw: string): ProviderAccountSecretMap {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TenantEmailConfigError('Tenant provider account configuration is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new TenantEmailConfigError(
      'Tenant provider account configuration must be a JSON object.',
    );
  }

  const out: ProviderAccountSecretMap = {};
  for (const [accountId, envVarName] of Object.entries(parsed)) {
    out[accountId] = parseOptionalString(envVarName, 'Tenant provider account configuration entry');
  }
  return out;
}

function resolveProviderApiToken(
  providerAccount: string,
  providerSecrets: ProviderAccountSecretMap,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const envVarName = providerSecrets[providerAccount];
  if (!envVarName) {
    throw new TenantEmailConfigError('Tenant provider account is not configured.');
  }
  const token = env[envVarName]?.trim();
  if (!token) {
    throw new TenantEmailConfigError('Tenant provider account is not configured.');
  }
  return token;
}

function parseOptionalString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string') {
    throw new TenantEmailConfigError(`${fieldPath} must be a string when provided.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TenantEmailConfigError(`${fieldPath} must be a non-empty string when provided.`);
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTenantEnvironment(value: string): value is TenantEnvironment {
  return value === 'development' || value === 'staging' || value === 'production';
}
