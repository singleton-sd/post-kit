import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { EmailProviderError } from '@singleton-sd/post-kit-email';
import { ensureAppConfiguration } from '../config/app-configuration';
import { contactCorsHeaders, submitContactInquiry } from '../contact';
import { clientIpFromHeaders, getContactRateLimiter } from '../contact-rate-limit';
import { createLogger, resolveCorrelationId } from '../telemetry';

export async function contactHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const startMs = Date.now();
  const correlationId = resolveCorrelationId(request.headers.get('x-correlation-id') ?? undefined);
  const logger = createLogger(correlationId);

  logger.info('contact.request.received');

  const origin = request.headers.get('origin');
  try {
    await ensureAppConfiguration();
  } catch (error) {
    context.error('app configuration load failed', {
      name: error instanceof Error ? error.name : 'Error',
    });
    return {
      status: 503,
      headers: {
        ...contactCorsHeaders(origin),
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      jsonBody: {
        error: 'Contact delivery is temporarily unavailable. Please try again later.',
      },
    };
  }
  const cors = contactCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: { ...cors, 'X-Correlation-Id': correlationId } };
  }

  const ip = clientIpFromHeaders(request.headers);
  const limit = getContactRateLimiter().tryConsume(ip);
  if (!limit.allowed) {
    return {
      status: 429,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Retry-After': String(limit.retryAfterSec),
        'X-Correlation-Id': correlationId,
      },
      jsonBody: { error: 'Too many messages were sent. Please wait a minute and try again.' },
    };
  }

  try {
    const body = await request.json().catch(() => null);
    const result = await submitContactInquiry(body, { requestOrigin: origin });
    const durationMs = Date.now() - startMs;
    logger.info('contact.request.completed', { outcome: 'sent', durationMs });
    return {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
      jsonBody: result,
    };
  } catch (error) {
    const durationMs = Date.now() - startMs;

    const errorCode =
      error instanceof EmailProviderError ? error.kind : (error as Error | undefined)?.name;

    context.error('contact failed', {
      name: error instanceof Error ? error.name : 'Error',
      kind: error instanceof EmailProviderError ? error.kind : undefined,
      statusCode: error instanceof EmailProviderError ? error.statusCode : undefined,
      correlationId: error instanceof EmailProviderError ? error.correlationId : undefined,
    });

    logger.error('contact.request.failed', { outcome: 'failed', errorCode, durationMs });

    const statusFromValidation =
      error instanceof Error && 'status' in error
        ? Number((error as Error & { status?: number }).status)
        : undefined;
    if (statusFromValidation === 400) {
      return {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
        jsonBody: { error: error instanceof Error ? error.message : 'Invalid request' },
      };
    }

    const unavailable =
      error instanceof EmailProviderError &&
      (error.kind === 'configuration' || error.kind === 'rate_limit' || error.kind === 'transient');

    return {
      status: unavailable ? 503 : 500,
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
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
