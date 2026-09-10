/**
 * Pure helpers for TENANT_KEY_MAP registration (used by register-tenant-api-key.sh).
 * Schema v2 stores SHA-256 digests only; legacy plaintext may remain under
 * `legacyPlaintext` for dual-read until operators re-register.
 * No Azure I/O — keep secrets out of this module's API surface.
 */
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TENANT_ENVIRONMENTS = Object.freeze(['development', 'staging', 'production']);
export const TENANT_KEY_REGISTRY_SCHEMA_VERSION = 2;
export const DEFAULT_POC_SCOPES = Object.freeze([
  'templates:read',
  'templates:validate',
  'templates:preview',
  'email:send',
]);

/**
 * @typedef {'development' | 'staging' | 'production'} TenantEnvironment
 * @typedef {{ tenantId: string, environment: TenantEnvironment }} TenantKeyMapEntry
 * @typedef {Record<string, TenantKeyMapEntry>} TenantKeyMap
 * @typedef {{
 *   keyHash: string,
 *   tenantId: string,
 *   environment: TenantEnvironment,
 *   scopes: readonly string[],
 *   revokedAt: string | null,
 *   expiresAt: string | null,
 * }} ApiKeyRecord
 * @typedef {{
 *   schemaVersion: 2,
 *   keys: Record<string, ApiKeyRecord>,
 *   legacyPlaintext?: TenantKeyMap,
 * }} TenantKeyRegistryV2
 */

/**
 * @param {string} environment
 * @returns {environment is TenantEnvironment}
 */
export function isTenantEnvironment(environment) {
  return TENANT_ENVIRONMENTS.includes(environment);
}

/**
 * @param {unknown} value
 * @returns {value is TenantKeyMapEntry}
 */
export function isTenantKeyMapEntry(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof obj.tenantId === 'string' &&
    obj.tenantId.length > 0 &&
    typeof obj.environment === 'string' &&
    isTenantEnvironment(obj.environment)
  );
}

/** @param {string} token */
export function hashApiKey(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Opaque principal id (`ak_` + truncated sha256). Never log the raw token. */
export function principalIdFromApiKey(token) {
  return `ak_${hashApiKey(token).slice(0, 16)}`;
}

/**
 * @param {unknown} value
 * @returns {value is TenantKeyMap}
 */
function isLegacyPlaintextMap(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  for (const [token, entry] of Object.entries(value)) {
    if (typeof token !== 'string' || token.length === 0 || !isTenantKeyMapEntry(entry)) {
      return false;
    }
  }
  return true;
}

/**
 * Non-null timestamps must be non-empty ISO-8601 strings that Date.parse accepts.
 * @param {string} value
 */
export function isValidIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * @param {unknown} value
 * @returns {value is string | null}
 */
function isOptionalTimestamp(value) {
  if (value === null) return true;
  return typeof value === 'string' && isValidIsoTimestamp(value);
}

/**
 * @param {unknown} value
 * @returns {value is readonly string[]}
 */
function isKnownScopes(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || !DEFAULT_POC_SCOPES.includes(item)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {unknown} value
 * @returns {value is ApiKeyRecord}
 */
function isApiKeyRecord(value) {
  if (typeof value !== 'object' || value === null) return false;
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (typeof obj.keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(obj.keyHash)) return false;
  if (typeof obj.tenantId !== 'string' || obj.tenantId.length === 0) return false;
  if (typeof obj.environment !== 'string' || !isTenantEnvironment(obj.environment)) return false;
  if (!isKnownScopes(obj.scopes)) return false;
  if (!isOptionalTimestamp(obj.revokedAt)) return false;
  if (!isOptionalTimestamp(obj.expiresAt)) return false;
  return true;
}

/**
 * Parse existing Key Vault JSON into a v2 registry document.
 * Empty / missing → empty v2. Pure legacy map → v2 with `legacyPlaintext`.
 * Invalid JSON or non-object throws.
 * @param {string | undefined | null} raw
 * @returns {TenantKeyRegistryV2}
 */
export function parseTenantKeyRegistryJson(raw) {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return { schemaVersion: TENANT_KEY_REGISTRY_SCHEMA_VERSION, keys: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TENANT_KEY_MAP secret is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('TENANT_KEY_MAP secret must be a JSON object');
  }

  const doc = /** @type {Record<string, unknown>} */ (parsed);
  if (doc.schemaVersion === TENANT_KEY_REGISTRY_SCHEMA_VERSION) {
    return parseV2Document(doc);
  }

  // Pure legacy plaintext map — keep under legacyPlaintext for dual-read.
  if (!isLegacyPlaintextMap(parsed)) {
    throw new Error('TENANT_KEY_MAP entry for token is invalid (tenantId/environment)');
  }
  return {
    schemaVersion: TENANT_KEY_REGISTRY_SCHEMA_VERSION,
    keys: {},
    legacyPlaintext: /** @type {TenantKeyMap} */ ({ ...parsed }),
  };
}

/**
 * @deprecated Prefer {@link parseTenantKeyRegistryJson}. Returns legacyPlaintext only.
 * @param {string | undefined | null} raw
 * @returns {TenantKeyMap}
 */
export function parseTenantKeyMapJson(raw) {
  const registry = parseTenantKeyRegistryJson(raw);
  return { ...(registry.legacyPlaintext ?? {}) };
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {TenantKeyRegistryV2}
 */
function parseV2Document(doc) {
  const keysRaw = doc.keys;
  if (typeof keysRaw !== 'object' || keysRaw === null || Array.isArray(keysRaw)) {
    throw new Error('TENANT_KEY_MAP secret must be a JSON object');
  }
  /** @type {Record<string, ApiKeyRecord>} */
  const keys = {};
  for (const [id, entry] of Object.entries(keysRaw)) {
    if (typeof id !== 'string' || id.length === 0 || !isApiKeyRecord(entry)) {
      throw new Error('TENANT_KEY_MAP hashed key entry is invalid');
    }
    keys[id] = {
      keyHash: entry.keyHash,
      tenantId: entry.tenantId,
      environment: entry.environment,
      scopes: [...entry.scopes],
      revokedAt: entry.revokedAt,
      expiresAt: entry.expiresAt,
    };
  }

  /** @type {TenantKeyRegistryV2} */
  const result = { schemaVersion: TENANT_KEY_REGISTRY_SCHEMA_VERSION, keys };
  if (doc.legacyPlaintext !== undefined) {
    if (!isLegacyPlaintextMap(doc.legacyPlaintext)) {
      throw new Error('TENANT_KEY_MAP legacyPlaintext entry is invalid (tenantId/environment)');
    }
    result.legacyPlaintext = /** @type {TenantKeyMap} */ ({ ...doc.legacyPlaintext });
  }
  return result;
}

/**
 * Build a token of the form `tk_<envShort>_<64 hex chars>`.
 * @param {TenantEnvironment} environment
 * @param {(size: number) => Buffer} [randomBytesFn]
 */
export function generateTenantApiToken(environment, randomBytesFn = nodeRandomBytes) {
  if (!isTenantEnvironment(environment)) {
    throw new Error(`invalid environment: ${environment}`);
  }
  const short = environment === 'development' ? 'dev' : environment === 'staging' ? 'stg' : 'live';
  return `tk_${short}_${randomBytesFn(32).toString('hex')}`;
}

/**
 * Upsert a hashed key record. Never writes plaintext into `keys`.
 * If the token still exists under `legacyPlaintext`, remove it after hashing.
 * Does not mutate `existing`.
 *
 * @param {TenantKeyRegistryV2} existing
 * @param {string} token
 * @param {string} tenantId
 * @param {TenantEnvironment} environment
 * @param {{ scopes?: readonly string[], expiresAt?: string | null }} [options]
 * @returns {{ registry: TenantKeyRegistryV2, principalId: string, replaced: boolean }}
 */
export function upsertHashedKeyRecord(existing, token, tenantId, environment, options = {}) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('token must be a non-empty string of at least 16 characters');
  }
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required');
  }
  if (!isTenantEnvironment(environment)) {
    throw new Error(`invalid environment: ${environment}`);
  }

  const principalId = principalIdFromApiKey(token);
  const scopes = options.scopes ? [...options.scopes] : [...DEFAULT_POC_SCOPES];
  if (!isKnownScopes(scopes)) {
    throw new Error('scopes must be a non-empty list of known PostKit scope strings');
  }
  const expiresAt = options.expiresAt === undefined ? null : options.expiresAt;
  if (expiresAt !== null && !isValidIsoTimestamp(expiresAt)) {
    throw new Error('expiresAt must be null or a valid ISO-8601 timestamp');
  }
  const replaced = Object.prototype.hasOwnProperty.call(existing.keys, principalId);

  /** @type {Record<string, ApiKeyRecord>} */
  const keys = {
    ...existing.keys,
    [principalId]: {
      keyHash: hashApiKey(token),
      tenantId: tenantId.trim(),
      environment,
      scopes,
      revokedAt: null,
      expiresAt,
    },
  };

  /** @type {TenantKeyMap | undefined} */
  let legacyPlaintext = existing.legacyPlaintext ? { ...existing.legacyPlaintext } : undefined;
  if (legacyPlaintext && Object.prototype.hasOwnProperty.call(legacyPlaintext, token)) {
    delete legacyPlaintext[token];
    if (Object.keys(legacyPlaintext).length === 0) {
      legacyPlaintext = undefined;
    }
  }

  /** @type {TenantKeyRegistryV2} */
  const registry = {
    schemaVersion: TENANT_KEY_REGISTRY_SCHEMA_VERSION,
    keys,
  };
  if (legacyPlaintext && Object.keys(legacyPlaintext).length > 0) {
    registry.legacyPlaintext = legacyPlaintext;
  }

  return { registry, principalId, replaced };
}

/**
 * @deprecated Prefer {@link upsertHashedKeyRecord}. Kept for transitional tests.
 * @param {TenantKeyMap} existing
 * @param {string} token
 * @param {string} tenantId
 * @param {TenantEnvironment} environment
 */
export function upsertTenantKeyMapEntry(existing, token, tenantId, environment) {
  const asRegistry = {
    schemaVersion: /** @type {const} */ (TENANT_KEY_REGISTRY_SCHEMA_VERSION),
    keys: {},
    legacyPlaintext: existing,
  };
  const { registry, replaced } = upsertHashedKeyRecord(asRegistry, token, tenantId, environment);
  return { map: registry, replaced };
}

/**
 * Function App Key Vault reference value for the map secret.
 * @param {string} vaultName
 * @param {string} secretName
 */
export function tenantKeyMapKeyVaultReference(vaultName, secretName) {
  return `@Microsoft.KeyVault(SecretUri=https://${vaultName}.vault.azure.net/secrets/${secretName}/)`;
}

/**
 * Serialize a v2 registry for Key Vault. Omits empty legacyPlaintext.
 * @param {TenantKeyRegistryV2} registry
 */
export function serializeTenantKeyRegistry(registry) {
  /** @type {TenantKeyRegistryV2} */
  const out = {
    schemaVersion: TENANT_KEY_REGISTRY_SCHEMA_VERSION,
    keys: registry.keys,
  };
  if (registry.legacyPlaintext && Object.keys(registry.legacyPlaintext).length > 0) {
    out.legacyPlaintext = registry.legacyPlaintext;
  }
  return JSON.stringify(out);
}

/**
 * @param {string[]} args
 * @param {string} name
 */
function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * CLI for the shell wrapper.
 * argv: generate-token <environment>
 * argv: merge --tenant-id X --environment Y [--token T]   (existing map on stdin)
 * argv: kv-ref --vault NAME --secret NAME
 * @param {string[]} [argv]
 */
export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (cmd === 'generate-token') {
    const environment = rest[0];
    if (!environment || !isTenantEnvironment(environment)) {
      throw new Error('usage: generate-token <development|staging|production>');
    }
    process.stdout.write(generateTenantApiToken(environment));
    return;
  }
  if (cmd === 'kv-ref') {
    const vault = flagValue(rest, '--vault');
    const secret = flagValue(rest, '--secret');
    if (!vault || !secret) {
      throw new Error('usage: kv-ref --vault <name> --secret <name>');
    }
    process.stdout.write(tenantKeyMapKeyVaultReference(vault, secret));
    return;
  }
  if (cmd === 'merge') {
    const tenantId = flagValue(rest, '--tenant-id');
    const environment = flagValue(rest, '--environment');
    const token = flagValue(rest, '--token');
    if (!tenantId || !environment) {
      throw new Error('usage: merge --tenant-id <id> --environment <env> [--token <token>]');
    }
    if (!isTenantEnvironment(environment)) {
      throw new Error(`invalid environment: ${environment}`);
    }
    const existing = parseTenantKeyRegistryJson(readStdin());
    const resolvedToken = token ?? generateTenantApiToken(environment);
    const { registry, principalId, replaced } = upsertHashedKeyRecord(
      existing,
      resolvedToken,
      tenantId,
      environment,
    );
    process.stdout.write(
      JSON.stringify({
        token: resolvedToken,
        principalId,
        replaced,
        mapJson: serializeTenantKeyRegistry(registry),
      }),
    );
    return;
  }
  throw new Error('usage: generate-token | merge | kv-ref');
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : '';
const invokedDirectly =
  Boolean(process.argv[1]) &&
  (process.argv[1] === entryPath || process.argv[1].endsWith('tenant-key-map.mjs'));

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
