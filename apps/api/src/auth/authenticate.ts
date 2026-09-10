import type { HttpRequest } from '@azure/functions';
import {
  DEFAULT_POC_SCOPES,
  PostKitErrorCode,
  type Principal,
  type PostKitScope,
} from '@singleton-sd/post-kit-types';
import { createHash } from 'node:crypto';
import type { TenantKeyMap } from '../tenant';
import {
  apiKeyHashesEqual,
  asTenantKeyRegistry,
  hashApiKey,
  type ApiKeyRecord,
  type ParsedTenantKeyRegistry,
} from './tenant-key-registry';

/**
 * Error thrown by authentication / authorization helpers.
 * Carries a stable PostKitErrorCode; never includes raw credentials.
 */
export class AuthError extends Error {
  readonly code: PostKitErrorCode;

  constructor(message: string, code: PostKitErrorCode) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Resolves a Principal from an incoming HTTP request.
 * Implementations must never accept tenant identity or scopes from the body.
 */
export interface Authenticator {
  authenticate(request: HttpRequest): Promise<Principal>;
}

/**
 * Opaque principal id derived from the credential without retaining plaintext.
 * Truncated SHA-256 — never log the raw token.
 */
export function principalIdFromApiKey(token: string): string {
  const digest = createHash('sha256').update(token, 'utf8').digest('hex');
  return `ak_${digest.slice(0, 16)}`;
}

/**
 * Extract the Bearer token from an Authorization header.
 * Never returns or logs the token in error messages.
 */
export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader) {
    throw new AuthError('Authorization header is missing.', PostKitErrorCode.UNAUTHENTICATED);
  }

  // RFC 7235: auth-scheme is case-insensitive; accept one or more spaces.
  const bearerPrefixMatch = /^bearer +/i.exec(authHeader);
  if (!bearerPrefixMatch) {
    throw new AuthError(
      'Authorization header must use the Bearer scheme.',
      PostKitErrorCode.UNAUTHENTICATED,
    );
  }

  const token = authHeader.slice(bearerPrefixMatch[0].length);
  if (!token) {
    throw new AuthError('Bearer token is empty.', PostKitErrorCode.UNAUTHENTICATED);
  }

  return token;
}

/**
 * Look up a plaintext TENANT_KEY_MAP entry and build a Principal.
 * Legacy map entries receive {@link DEFAULT_POC_SCOPES} so send + MCP keep working.
 */
export function principalFromTenantKeyMap(
  token: string,
  keyMap: TenantKeyMap,
  scopes: readonly PostKitScope[] = DEFAULT_POC_SCOPES,
): Principal {
  const entry = Object.prototype.hasOwnProperty.call(keyMap, token) ? keyMap[token] : undefined;

  if (!entry) {
    throw new AuthError(
      'The provided credential does not map to a known tenant.',
      PostKitErrorCode.UNAUTHORIZED,
    );
  }

  return {
    id: principalIdFromApiKey(token),
    tenantId: entry.tenantId,
    environment: entry.environment,
    authType: 'api-key',
    scopes: [...scopes],
  };
}

function findHashedRecord(
  token: string,
  keys: Record<string, ApiKeyRecord>,
): { id: string; record: ApiKeyRecord } | undefined {
  const presentedHash = hashApiKey(token);
  let matched: { id: string; record: ApiKeyRecord } | undefined;
  for (const [id, record] of Object.entries(keys)) {
    if (apiKeyHashesEqual(record.keyHash, presentedHash)) {
      matched = { id, record };
    }
  }
  return matched;
}

function assertKeyActive(record: ApiKeyRecord): void {
  if (record.revokedAt != null && record.revokedAt !== '') {
    throw new AuthError(
      'The provided credential is no longer valid.',
      PostKitErrorCode.UNAUTHORIZED,
    );
  }
  if (record.expiresAt != null && record.expiresAt !== '') {
    const expiresMs = Date.parse(record.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      throw new AuthError(
        'The provided credential is no longer valid.',
        PostKitErrorCode.UNAUTHORIZED,
      );
    }
  }
}

/**
 * Authenticate an HTTP request via Bearer token against the hashed registry,
 * with dual-read fallback to legacy plaintext map entries.
 */
export class ApiKeyAuthenticator implements Authenticator {
  private readonly registry: ParsedTenantKeyRegistry;
  private readonly legacyScopes: readonly PostKitScope[];

  constructor(
    registry: ParsedTenantKeyRegistry | TenantKeyMap,
    legacyScopes: readonly PostKitScope[] = DEFAULT_POC_SCOPES,
  ) {
    this.registry = asTenantKeyRegistry(registry);
    this.legacyScopes = legacyScopes;
  }

  async authenticate(request: HttpRequest): Promise<Principal> {
    const token = extractBearerToken(request.headers.get('authorization'));

    const hashed = findHashedRecord(token, this.registry.keys);
    if (hashed) {
      assertKeyActive(hashed.record);
      return {
        id: hashed.id,
        tenantId: hashed.record.tenantId,
        environment: hashed.record.environment,
        authType: 'api-key',
        scopes: [...hashed.record.scopes],
      };
    }

    return principalFromTenantKeyMap(token, this.registry.legacyPlaintext, this.legacyScopes);
  }
}

/**
 * Require that the principal holds the given scope.
 * Throws AuthError with UNAUTHORIZED — message is non-sensitive (no raw keys).
 */
export function requireScope(principal: Principal, scope: PostKitScope): void {
  if (!principal.scopes.includes(scope)) {
    throw new AuthError(
      'The credential does not have the required permission.',
      PostKitErrorCode.UNAUTHORIZED,
    );
  }
}

/**
 * Tenant identity derived from the authenticated principal (never from tool/body input).
 */
export function tenantContextFromPrincipal(principal: Principal): {
  tenantId: string;
  environment: Principal['environment'];
} {
  return { tenantId: principal.tenantId, environment: principal.environment };
}
