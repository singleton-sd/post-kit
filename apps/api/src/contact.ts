import {
  createEmailProvider,
  DevelopmentEmailProvider,
  sendContactInquiryEmail,
  validateContactInquiry,
  type EmailProvider,
} from '@singleton-sd/post-kit-email';
import { isAllowedHostname, parseOrigins } from './origins';

export {
  buildContactEmailRequest,
  CONTACT_SUBJECTS,
  hasForbiddenControls,
  validateContactInquiry,
  type ContactInquiryInput,
  type ContactSubject,
} from '@singleton-sd/post-kit-email';

/**
 * Resolve a trusted marketing-site host from Origin using the ORIGINS allowlist.
 * Untrusted or missing Origin values return null so host-profile overrides are skipped.
 */
export function resolveTrustedContactHost(
  requestOrigin: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!requestOrigin) return null;

  let allowlist: string[];
  try {
    allowlist = parseOrigins(env.ORIGINS);
  } catch {
    return null;
  }

  try {
    const host = new URL(requestOrigin).host;
    return isAllowedHostname(host, allowlist) ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Preview SWA hosts must not trigger real outbound email against the shared
 * Function App unless EMAIL_ALLOW_PREVIEW_SEND=true.
 */
export function resolveContactEmailProvider(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
): EmailProvider {
  if (requestOrigin && env.EMAIL_ALLOW_PREVIEW_SEND !== 'true') {
    try {
      const host = new URL(requestOrigin).host.toLowerCase();
      if (host.endsWith('.azurestaticapps.net') || host.startsWith('localhost')) {
        return new DevelopmentEmailProvider({ logMetadata: true });
      }
    } catch {
      // fall through to configured provider
    }
  }
  return createEmailProvider(env);
}

export async function submitContactInquiry(
  body: unknown,
  options: {
    requestOrigin?: string | null;
    email?: EmailProvider;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ id: string; status: 'sent' }> {
  const validated = validateContactInquiry(body);
  if (!validated.ok) {
    const error = new Error(validated.error);
    (error as Error & { status: number }).status = validated.status;
    throw error;
  }

  const env = options.env ?? process.env;
  const email = options.email ?? resolveContactEmailProvider(options.requestOrigin ?? null, env);
  const result = await sendContactInquiryEmail(validated.value, email, env, {
    trustedRequestHost: resolveTrustedContactHost(options.requestOrigin ?? null, env),
  });
  return { id: result.id, status: result.status };
}

/** CORS: reflect Origin when it matches the ORIGINS allowlist. */
export function contactCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
  if (!requestOrigin) return headers;

  let allowlist: string[];
  try {
    allowlist = parseOrigins(process.env.ORIGINS);
  } catch {
    return headers;
  }

  try {
    const host = new URL(requestOrigin).host;
    if (isAllowedHostname(host, allowlist)) {
      headers['Access-Control-Allow-Origin'] = requestOrigin;
      headers.Vary = 'Origin';
    }
  } catch {
    return headers;
  }
  return headers;
}
