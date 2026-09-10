/**
 * Authentication / authorization contracts.
 *
 * Transport-independent principal produced after credential verification.
 * REST and MCP share the same Principal + scope checks so authorization is
 * not tied to a specific route or tool name.
 */

import type { TenantEnvironment } from './tenant';

/** How the caller authenticated. Entra is reserved for a later iteration. */
export type AuthType = 'api-key' | 'entra';

/**
 * Semantic permissions enforced at the application boundary.
 * Prefer these over transport-specific route permissions.
 */
export type PostKitScope =
  'templates:read' | 'templates:validate' | 'templates:preview' | 'email:send';

/** All known PostKit scopes (stable order for docs/tests). */
export const POSTKIT_SCOPES = [
  'templates:read',
  'templates:validate',
  'templates:preview',
  'email:send',
] as const satisfies readonly PostKitScope[];

/**
 * Default scopes granted to legacy `TENANT_KEY_MAP` entries (Iteration 2 PoC).
 * Full set so existing send + MCP template tools keep working until hashed
 * keys carry explicit scopes.
 */
export const DEFAULT_POC_SCOPES = [...POSTKIT_SCOPES] as const satisfies readonly PostKitScope[];

/**
 * Authenticated caller identity for one request.
 * Never accept tenantId / environment / scopes from the request body.
 */
export interface Principal {
  /**
   * Opaque principal id (never the raw API key).
   * For API-key auth this is typically a truncated hash of the credential.
   */
  id: string;
  /** Tenant bound to the credential. */
  tenantId: string;
  /** Environment bound to the credential. */
  environment: TenantEnvironment;
  authType: AuthType;
  /** Granted permissions for this credential. */
  scopes: readonly PostKitScope[];
}
