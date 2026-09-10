import type { HttpRequest } from '@azure/functions';
import type { Principal } from '@singleton-sd/post-kit-types';
import type { Authenticator } from '../auth';
import { AuthError } from '../auth';

/**
 * Resolve the calling principal from the Bearer API key on an MCP HTTP request.
 * Same ApiKeyAuthenticator / TENANT_KEY_MAP path as REST send.
 */
export async function resolveMcpPrincipal(
  request: HttpRequest,
  authenticator: Authenticator,
): Promise<Principal> {
  return authenticator.authenticate(request);
}

export { AuthError };
