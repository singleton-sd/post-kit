/**
 * Pure helpers for TENANT_KEY_MAP registration (used by register-tenant-api-key.sh).
 * No Azure I/O — keep secrets out of this module's API surface.
 */
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TENANT_ENVIRONMENTS = Object.freeze(['development', 'staging', 'production']);

/**
 * @typedef {'development' | 'staging' | 'production'} TenantEnvironment
 * @typedef {{ tenantId: string, environment: TenantEnvironment }} TenantKeyMapEntry
 * @typedef {Record<string, TenantKeyMapEntry>} TenantKeyMap
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

/**
 * Parse existing Key Vault JSON. Empty / missing → `{}`.
 * Invalid JSON or non-object throws.
 * @param {string | undefined | null} raw
 * @returns {TenantKeyMap}
 */
export function parseTenantKeyMapJson(raw) {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return {};
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
  /** @type {TenantKeyMap} */
  const result = {};
  for (const [token, entry] of Object.entries(parsed)) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('TENANT_KEY_MAP contains an empty token key');
    }
    if (!isTenantKeyMapEntry(entry)) {
      throw new Error('TENANT_KEY_MAP entry for token is invalid (tenantId/environment)');
    }
    result[token] = entry;
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
 * Upsert one token → { tenantId, environment }. Does not mutate `existing`.
 * @param {TenantKeyMap} existing
 * @param {string} token
 * @param {string} tenantId
 * @param {TenantEnvironment} environment
 * @returns {{ map: TenantKeyMap, replaced: boolean }}
 */
export function upsertTenantKeyMapEntry(existing, token, tenantId, environment) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('token must be a non-empty string of at least 16 characters');
  }
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId is required');
  }
  if (!isTenantEnvironment(environment)) {
    throw new Error(`invalid environment: ${environment}`);
  }
  const replaced = Object.prototype.hasOwnProperty.call(existing, token);
  return {
    map: {
      ...existing,
      [token]: { tenantId: tenantId.trim(), environment },
    },
    replaced,
  };
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
    const existing = parseTenantKeyMapJson(readStdin());
    const resolvedToken = token ?? generateTenantApiToken(environment);
    const { map, replaced } = upsertTenantKeyMapEntry(
      existing,
      resolvedToken,
      tenantId,
      environment,
    );
    process.stdout.write(
      JSON.stringify({
        token: resolvedToken,
        replaced,
        mapJson: JSON.stringify(map),
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
