import type { HttpRequest } from '@azure/functions';
import type { TenantContext } from '@singleton-sd/post-kit-types';
import type { TenantResolver } from '../tenant';
import { TenantResolverError } from '../tenant';

/**
 * Resolve the calling tenant from the Bearer API key on an MCP HTTP request.
 * Reuses the same ApiKeyTenantResolver / TENANT_KEY_MAP path as REST.
 *
 * Iteration 1 PoC auth — replaceable by the shared principal layer in #83.
 */
export async function resolveMcpTenant(
  request: HttpRequest,
  tenantResolver: TenantResolver,
): Promise<TenantContext> {
  return tenantResolver.resolve(request);
}

export { TenantResolverError };
