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
 * Resolve a marketing-site host from Origin using the ORIGINS allowlist.
 * Untrusted or missing Origin values return null so host-profile overrides are skipped.
 *
 * Phase 1 tenant routing is this host-profile map (issue #8); authenticated
 * tenant resolution is later work on epic #2. Origin is a routing hint, not proof
 * of the caller — CORS does not stop a direct request that spoofs an allowlisted host.
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
 * Header marketing PR-preview pages must set so PostKit can tell them apart from
 * production on the same host. `Origin` never includes the URL path, and the
 * default browser Referrer-Policy strips the path on cross-origin POSTs, so a
 * dedicated header is the only reliable same-host preview signal.
 */
export const CONTACT_PREVIEW_HEADER = 'x-postkit-contact-preview';

/**
 * True when the request should use DevelopmentEmailProvider unless the operator
 * has set EMAIL_ALLOW_PREVIEW_SEND=true.
 *
 * Covers:
 * - SWA default / PR hosts (`*.azurestaticapps.net`)
 * - localhost
 * - same-host path previews that send `X-PostKit-Contact-Preview: 1|true`
 * - Referer paths containing `/pr-preview/` when a full Referer URL is present
 */
export function isPreviewContactTraffic(
  requestOrigin: string | null | undefined,
  options: {
    requestReferer?: string | null;
    previewHeader?: string | null;
  } = {},
): boolean {
  const previewHeader = options.previewHeader?.trim().toLowerCase();
  if (previewHeader === '1' || previewHeader === 'true') {
    return true;
  }

  if (options.requestReferer) {
    try {
      const refererPath = new URL(options.requestReferer).pathname;
      if (/(?:^|\/)pr-preview(?:\/|$)/.test(refererPath)) {
        return true;
      }
    } catch {
      // ignore malformed Referer
    }
  }

  if (!requestOrigin) return false;
  try {
    const host = new URL(requestOrigin).host.toLowerCase();
    return host.endsWith('.azurestaticapps.net') || host.startsWith('localhost');
  } catch {
    return false;
  }
}

/**
 * Preview traffic must not trigger real outbound email against the shared
 * Function App unless EMAIL_ALLOW_PREVIEW_SEND=true.
 */
export function resolveContactEmailProvider(
  requestOrigin: string | null,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    requestReferer?: string | null;
    previewHeader?: string | null;
  } = {},
): EmailProvider {
  if (env.EMAIL_ALLOW_PREVIEW_SEND !== 'true' && isPreviewContactTraffic(requestOrigin, options)) {
    return new DevelopmentEmailProvider({ logMetadata: true });
  }
  return createEmailProvider(env);
}

export async function submitContactInquiry(
  body: unknown,
  options: {
    requestOrigin?: string | null;
    requestReferer?: string | null;
    previewHeader?: string | null;
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
  const email =
    options.email ??
    resolveContactEmailProvider(options.requestOrigin ?? null, env, {
      requestReferer: options.requestReferer,
      previewHeader: options.previewHeader,
    });
  const result = await sendContactInquiryEmail(validated.value, email, env, {
    trustedRequestHost: resolveTrustedContactHost(options.requestOrigin ?? null, env),
  });
  return { id: result.id, status: result.status };
}

/** CORS: reflect Origin when it matches the ORIGINS allowlist. */
export function contactCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, Accept, ${CONTACT_PREVIEW_HEADER}`,
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
