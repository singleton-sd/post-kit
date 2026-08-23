import type { HttpRequest } from '@azure/functions';
import {
  PostKitErrorCode,
  type TenantContext,
  type TenantEnvironment,
} from '@singleton-sd/post-kit-types';
import type { TenantResolver } from './tenant-resolver';

/**
 * Maps bearer tokens to their associated tenant identity.
 * Injected at construction — never hard-coded.
 *
 * @example
 * {
 *   "tk_live_abc123": { tenantId: "inkads", environment: "production" },
 *   "tk_dev_xyz789": { tenantId: "inkads", environment: "development" },
 * }
 */
export type TenantKeyMap = Record<string, { tenantId: string; environment: TenantEnvironment }>;

/**
 * Error thrown by TenantResolver when authentication or authorization fails.
 * Always carry a stable `code` for programmatic handling.
 */
export class TenantResolverError extends Error {
  readonly code: PostKitErrorCode;

  constructor(message: string, code: PostKitErrorCode) {
    super(message);
    this.name = 'TenantResolverError';
    this.code = code;
  }
}

/**
 * Resolves tenant identity from an `Authorization: Bearer <token>` header.
 *
 * The token is looked up in the injected `TenantKeyMap`. The raw token value
 * is never logged — only its presence or absence is mentioned in error messages.
 *
 * Throws `TenantResolverError` with:
 *   - `PostKitErrorCode.UNAUTHENTICATED` — missing or malformed Authorization header
 *   - `PostKitErrorCode.UNAUTHORIZED`    — token not found in the key map
 */
export class ApiKeyTenantResolver implements TenantResolver {
  private readonly keyMap: TenantKeyMap;

  constructor(keyMap: TenantKeyMap) {
    this.keyMap = keyMap;
  }

  async resolve(request: HttpRequest): Promise<TenantContext> {
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new TenantResolverError(
        'Authorization header is missing.',
        PostKitErrorCode.UNAUTHENTICATED,
      );
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new TenantResolverError(
        'Authorization header must use the Bearer scheme.',
        PostKitErrorCode.UNAUTHENTICATED,
      );
    }

    const token = authHeader.slice('Bearer '.length);

    if (!token) {
      throw new TenantResolverError('Bearer token is empty.', PostKitErrorCode.UNAUTHENTICATED);
    }

    const entry = this.keyMap[token];

    if (!entry) {
      // Do not include the token value in this message.
      throw new TenantResolverError(
        'The provided credential does not map to a known tenant.',
        PostKitErrorCode.UNAUTHORIZED,
      );
    }

    return { tenantId: entry.tenantId, environment: entry.environment };
  }
}
