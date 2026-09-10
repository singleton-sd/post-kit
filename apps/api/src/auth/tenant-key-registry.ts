/**
 * Versioned TENANT_KEY_MAP / Key Vault `tenant-key-map` document.
 *
 * Schema v2 stores only SHA-256 digests of API tokens. Legacy plaintext maps
 * and optional `legacyPlaintext` leftovers remain dual-readable during cutover.
 */

import {
  DEFAULT_POC_SCOPES,
  POSTKIT_SCOPES,
  type PostKitScope,
  type TenantEnvironment,
} from '@singleton-sd/post-kit-types';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Logger } from '../telemetry';
import type { TenantKeyMap } from '../tenant';

export const TENANT_KEY_REGISTRY_SCHEMA_VERSION = 2 as const;

const TENANT_ENVIRONMENTS = new Set<TenantEnvironment>(['development', 'staging', 'production']);
const KNOWN_SCOPES = new Set<string>(POSTKIT_SCOPES);

/** One hashed API key record (never contains the raw token). */
export interface ApiKeyRecord {
  keyHash: string;
  tenantId: string;
  environment: TenantEnvironment;
  scopes: readonly PostKitScope[];
  revokedAt: string | null;
  expiresAt: string | null;
}

/**
 * In-memory registry used by {@link ApiKeyAuthenticator}.
 * `keys` are keyed by opaque principal id (`ak_…`).
 */
export interface ParsedTenantKeyRegistry {
  keys: Record<string, ApiKeyRecord>;
  legacyPlaintext: TenantKeyMap;
}

/** SHA-256 hex digest of a UTF-8 API token (stored as `keyHash`). */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time equality for equal-length hex digests. */
export function apiKeyHashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function isTenantEnvironment(value: unknown): value is TenantEnvironment {
  return typeof value === 'string' && TENANT_ENVIRONMENTS.has(value as TenantEnvironment);
}

function isLegacyEntry(value: unknown): value is TenantKeyMap[string] {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['tenantId'] === 'string' &&
    obj['tenantId'].length > 0 &&
    isTenantEnvironment(obj['environment'])
  );
}

function parseScopes(value: unknown): readonly PostKitScope[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const scopes: PostKitScope[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || !KNOWN_SCOPES.has(item)) return undefined;
    scopes.push(item as PostKitScope);
  }
  return scopes;
}

/** Non-null timestamps must be non-empty ISO-8601 strings that Date.parse accepts. */
export function isValidIsoTimestamp(value: string): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !Number.isNaN(Date.parse(value));
}

function isOptionalTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === 'string' && isValidIsoTimestamp(value);
}

function isApiKeyRecord(value: unknown): value is ApiKeyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj['keyHash'] !== 'string' || !/^[a-f0-9]{64}$/.test(obj['keyHash'])) return false;
  if (typeof obj['tenantId'] !== 'string' || obj['tenantId'].length === 0) return false;
  if (!isTenantEnvironment(obj['environment'])) return false;
  const scopes = parseScopes(obj['scopes']);
  if (!scopes) return false;
  if (!isOptionalTimestamp(obj['revokedAt'])) return false;
  if (!isOptionalTimestamp(obj['expiresAt'])) return false;
  return true;
}

function parseLegacyPlaintextMap(value: unknown): TenantKeyMap | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: TenantKeyMap = {};
  for (const [token, entry] of Object.entries(value)) {
    if (typeof token !== 'string' || token.length === 0 || !isLegacyEntry(entry)) {
      return undefined;
    }
    result[token] = entry;
  }
  return result;
}

function emptyRegistry(): ParsedTenantKeyRegistry {
  return { keys: {}, legacyPlaintext: {} };
}

/**
 * Parse TENANT_KEY_MAP JSON into a dual-read registry.
 * Invalid JSON / shape → empty registry (and optional structured log).
 * Never logs raw tokens or secret contents.
 */
export function parseTenantKeyRegistry(
  raw: string | undefined,
  log?: Logger,
): ParsedTenantKeyRegistry {
  if (!raw?.trim()) return emptyRegistry();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log?.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_JSON',
    });
    return emptyRegistry();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log?.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_SHAPE',
    });
    return emptyRegistry();
  }

  const doc = parsed as Record<string, unknown>;

  if (doc['schemaVersion'] === TENANT_KEY_REGISTRY_SCHEMA_VERSION) {
    return parseV2Document(doc, log);
  }

  // Pure legacy plaintext map (no schemaVersion).
  const legacy = parseLegacyPlaintextMap(parsed);
  if (!legacy) {
    log?.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_ENTRY',
    });
    return emptyRegistry();
  }
  return { keys: {}, legacyPlaintext: legacy };
}

function parseV2Document(doc: Record<string, unknown>, log?: Logger): ParsedTenantKeyRegistry {
  const keysRaw = doc['keys'];
  if (typeof keysRaw !== 'object' || keysRaw === null || Array.isArray(keysRaw)) {
    log?.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_SHAPE',
    });
    return emptyRegistry();
  }

  const keys: Record<string, ApiKeyRecord> = {};
  for (const [id, entry] of Object.entries(keysRaw)) {
    if (typeof id !== 'string' || id.length === 0 || !isApiKeyRecord(entry)) {
      log?.error('tenant_key_map.invalid', {
        outcome: 'failed',
        failureCategory: 'configuration',
        errorCode: 'TENANT_KEY_MAP_INVALID_ENTRY',
      });
      return emptyRegistry();
    }
    keys[id] = {
      keyHash: entry.keyHash,
      tenantId: entry.tenantId,
      environment: entry.environment,
      scopes: [...(parseScopes(entry.scopes) ?? DEFAULT_POC_SCOPES)],
      revokedAt: entry.revokedAt,
      expiresAt: entry.expiresAt,
    };
  }

  let legacyPlaintext: TenantKeyMap = {};
  if (doc['legacyPlaintext'] !== undefined) {
    const legacy = parseLegacyPlaintextMap(doc['legacyPlaintext']);
    if (!legacy) {
      log?.error('tenant_key_map.invalid', {
        outcome: 'failed',
        failureCategory: 'configuration',
        errorCode: 'TENANT_KEY_MAP_INVALID_ENTRY',
      });
      return emptyRegistry();
    }
    legacyPlaintext = legacy;
  }

  return { keys, legacyPlaintext };
}

/** Normalize a legacy plaintext map or a parsed registry for the authenticator. */
export function asTenantKeyRegistry(
  input: ParsedTenantKeyRegistry | TenantKeyMap,
): ParsedTenantKeyRegistry {
  if (isParsedRegistry(input)) {
    return input;
  }
  return { keys: {}, legacyPlaintext: input };
}

function isParsedRegistry(
  input: ParsedTenantKeyRegistry | TenantKeyMap,
): input is ParsedTenantKeyRegistry {
  return (
    typeof input === 'object' &&
    input !== null &&
    'keys' in input &&
    'legacyPlaintext' in input &&
    typeof (input as ParsedTenantKeyRegistry).keys === 'object' &&
    typeof (input as ParsedTenantKeyRegistry).legacyPlaintext === 'object'
  );
}
