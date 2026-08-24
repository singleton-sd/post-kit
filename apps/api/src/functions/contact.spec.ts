import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import { getContactRateLimiter } from '../contact-rate-limit';
import { contactHandler } from './contact';

function fakeRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
}): HttpRequest {
  const headers = new Headers(options.headers);
  return {
    method: options.method ?? 'POST',
    headers: {
      get: (name: string) => headers.get(name),
    },
    json: async () => options.json ?? null,
  } as unknown as HttpRequest;
}

function fakeContext(): InvocationContext & { errors: unknown[] } {
  const errors: unknown[] = [];
  return {
    error: (...args: unknown[]) => {
      errors.push(args);
    },
    errors,
  } as unknown as InvocationContext & { errors: unknown[] };
}

describe('contactHandler', () => {
  it('propagates a valid X-Correlation-Id on validation errors and includes it in the body', async () => {
    getContactRateLimiter().reset();
    const correlationId = 'client-corr-id-01';
    const response = await contactHandler(
      fakeRequest({
        headers: { 'x-correlation-id': correlationId },
        json: { name: 'bad' },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 400);
    assert.equal(response.headers?.['X-Correlation-Id'], correlationId);
    assert.equal((response.jsonBody as { correlationId?: string }).correlationId, correlationId);
    assert.equal(typeof (response.jsonBody as { error?: string }).error, 'string');
  });

  it('generates a correlation ID when the header is absent', async () => {
    getContactRateLimiter().reset();
    const response = await contactHandler(fakeRequest({ json: { name: 'bad' } }), fakeContext());

    assert.equal(response.status, 400);
    const headerId = response.headers?.['X-Correlation-Id'];
    assert.equal(typeof headerId, 'string');
    assert.match(headerId ?? '', /^[0-9a-f-]{36}$/i);
    assert.equal((response.jsonBody as { correlationId?: string }).correlationId, headerId);
  });

  it('logs the request correlation ID on native error output, not the provider ID', async () => {
    getContactRateLimiter().reset();
    const correlationId = 'handler-corr-id-01';
    const context = fakeContext();
    await contactHandler(
      fakeRequest({
        headers: { 'x-correlation-id': correlationId },
        json: { name: 'bad' },
      }),
      context,
    );

    const logged = context.errors[0] as [string, { correlationId?: string }];
    assert.equal(logged[1]?.correlationId, correlationId);
    assert.ok(!('emailCorrelationId' in (logged[1] ?? {}) && logged[1].emailCorrelationId));
  });
});
