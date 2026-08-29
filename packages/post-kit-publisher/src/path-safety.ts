import type { TenantEnvironment } from '@singleton-sd/post-kit-types';

const SAFE_SEGMENT = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const SAFE_TEMPLATE_KEY = /^[a-zA-Z0-9._-]+$/;
/** Azure Storage account names: 3–24 lowercase letters and digits. */
const SAFE_STORAGE_ACCOUNT = /^[a-z0-9]{3,24}$/;
const ENVIRONMENTS = new Set<TenantEnvironment>(['development', 'staging', 'production']);

export function assertSafeTenantId(tenant: string): void {
  if (!tenant || !SAFE_SEGMENT.test(tenant) || tenant.includes('..')) {
    throw new Error(
      `Invalid tenant "${tenant}". Use alphanumeric characters and hyphens only (no path segments).`,
    );
  }
}

export function assertSafeEnvironment(
  environment: string,
): asserts environment is TenantEnvironment {
  if (!ENVIRONMENTS.has(environment as TenantEnvironment)) {
    throw new Error(
      `Invalid environment "${environment}". Must be one of: development, staging, production.`,
    );
  }
}

export function assertSafeTemplateKey(templateKey: string): void {
  if (
    !templateKey ||
    templateKey === '.' ||
    templateKey === '..' ||
    !SAFE_TEMPLATE_KEY.test(templateKey)
  ) {
    throw new Error(
      `Invalid template key "${templateKey}". Must match /^[a-zA-Z0-9._-]+$/ and must not be "." or "..".`,
    );
  }
}

export function assertSafeStorageAccount(storageAccount: string): void {
  if (!SAFE_STORAGE_ACCOUNT.test(storageAccount)) {
    throw new Error(`Invalid storage account "${storageAccount}". Must match /^[a-z0-9]{3,24}$/.`);
  }
}

export function blobBasePath(
  tenant: string,
  environment: TenantEnvironment,
  templateKey: string,
): string {
  assertSafeTenantId(tenant);
  assertSafeEnvironment(environment);
  assertSafeTemplateKey(templateKey);
  return `${templatesPrefix(tenant, environment)}/${templateKey}`;
}

/** Blob prefix for all templates of a tenant/environment (no trailing slash). */
export function templatesPrefix(tenant: string, environment: TenantEnvironment): string {
  assertSafeTenantId(tenant);
  assertSafeEnvironment(environment);
  return `tenants/${tenant}/${environment}/templates`;
}

/** True when `blobPath` is a blob under `templatesPrefix` for a single template key. */
export function isScopedTemplateBlob(blobPath: string, prefix: string): boolean {
  if (!blobPath.startsWith(`${prefix}/`)) {
    return false;
  }
  const rest = blobPath.slice(prefix.length + 1);
  const slash = rest.indexOf('/');
  if (slash === -1) {
    return false;
  }
  const key = rest.slice(0, slash);
  try {
    assertSafeTemplateKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Extract the template key from a blob under `templatesPrefix`, or undefined if out of scope. */
export function templateKeyFromBlobPath(blobPath: string, prefix: string): string | undefined {
  if (!isScopedTemplateBlob(blobPath, prefix)) {
    return undefined;
  }
  const rest = blobPath.slice(prefix.length + 1);
  return rest.slice(0, rest.indexOf('/'));
}
