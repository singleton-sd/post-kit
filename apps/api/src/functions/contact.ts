import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { EmailProviderError } from '@singleton-sd/post-kit-email';
import { contactCorsHeaders, submitContactInquiry } from '../contact';
import { clientIpFromHeaders, contactRateLimiter } from '../contact-rate-limit';

export async function contactHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin');
  const cors = contactCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: cors };
  }

  const ip = clientIpFromHeaders(request.headers);
  const limit = contactRateLimiter.tryConsume(ip);
  if (!limit.allowed) {
    return {
      status: 429,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Retry-After': String(limit.retryAfterSec),
      },
      jsonBody: { error: 'Too many messages were sent. Please wait a minute and try again.' },
    };
  }

  try {
    const body = await request.json().catch(() => null);
    const result = await submitContactInquiry(body, { requestOrigin: origin });
    return {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json' },
      jsonBody: result,
    };
  } catch (error) {
    context.error('contact failed', {
      name: error instanceof Error ? error.name : 'Error',
      kind: error instanceof EmailProviderError ? error.kind : undefined,
      statusCode: error instanceof EmailProviderError ? error.statusCode : undefined,
      correlationId: error instanceof EmailProviderError ? error.correlationId : undefined,
    });

    const statusFromValidation =
      error instanceof Error && 'status' in error
        ? Number((error as Error & { status?: number }).status)
        : undefined;
    if (statusFromValidation === 400) {
      return {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
        jsonBody: { error: error instanceof Error ? error.message : 'Invalid request' },
      };
    }

    const unavailable =
      error instanceof EmailProviderError &&
      (error.kind === 'configuration' || error.kind === 'rate_limit' || error.kind === 'transient');

    return {
      status: unavailable ? 503 : 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      jsonBody: {
        error: unavailable
          ? 'Contact delivery is temporarily unavailable. Please try again later.'
          : 'We could not send your message. Please try again shortly.',
      },
    };
  }
}

app.http('contact', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'contact',
  handler: contactHandler,
});
