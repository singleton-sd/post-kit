import type { TenantContext } from '@singleton-sd/post-kit-types';
import type { HttpRequest } from '@azure/functions';

/**
 * Resolves the authenticated tenant identity from an incoming HTTP request.
 *
 * Implementations must derive tenant identity from the request credential
 * (e.g., an Authorization bearer token) and must never accept tenant identity
 * from the request body.
 */
export interface TenantResolver {
  resolve(request: HttpRequest): Promise<TenantContext>;
}
