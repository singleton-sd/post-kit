import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendRequest,
  type EmailSendResult,
} from '@singleton-sd/post-kit-email';
import {
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { MemoryIdempotencyStore } from '../idempotency';
import { resetSendRateLimiter } from '../contact-rate-limit';
import {
  DEFAULT_SEND_PROVIDER_TIMEOUT_MS,
  resolveSendDeliveryPolicy,
  type SendDeliveryPolicy,
} from '../send-delivery';
import { createLogger } from '../telemetry';
import type { TenantResolver } from '../tenant';
import type { TemplateStore } from '../templates';
import { createSendHandler } from './send';

const TENANT: TenantContext = { tenantId: 'inkads', environment: 'development' };

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>Hello {{name}}</p>',
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi {{name}}',
    variables: ['name'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 'marketing.contact-us',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '2026-01-01T00:00:00.000Z',
    sourceCommit: '',
    variables: ['name'],
    contentHash: 'abc',
  },
};

function fakeRequest(options: { headers?: Record<string, string>; json?: unknown }): HttpRequest {
  const headers = new Headers(options.headers);
  const jsonBody = options.json ?? null;
  const textBody = jsonBody === null ? '' : JSON.stringify(jsonBody);
  return {
    method: 'POST',
    headers: { get: (name: string) => headers.get(name) },
    json: async () => jsonBody,
    text: async () => textBody,
  } as unknown as HttpRequest;
}

function fakeContext(): InvocationContext {
  return { error: () => undefined } as unknown as InvocationContext;
}

function fakeResolver(): TenantResolver {
  return { resolve: async () => TENANT };
}

function fakeStore(): TemplateStore {
  return { load: async () => COMPILED };
}

function stubSender() {
  return {
    resolveTenantEmailConfig: async () => ({
      fromAddress: 'noreply@example.com',
      fromDisplayName: 'PostKit',
    }),
  };
}

function validBody() {
  return {
    template: 'marketing.contact-us',
    to: 'user@example.com',
    variables: { name: 'Ada' },
  };
}

function fastPolicy(overrides: Partial<SendDeliveryPolicy> = {}): SendDeliveryPolicy {
  return {
    ...resolveSendDeliveryPolicy({
      SEND_PROVIDER_TIMEOUT_MS: '50',
      SEND_MAX_ATTEMPTS: '3',
      SEND_RETRY_BASE_DELAY_MS: '1',
    }),
    ...overrides,
  };
}

describe('sendHandler timeout / retry / classification', () => {
  it('bounds a hanging provider with a timeout and logs failureClass=transient', async () => {
    resetSendRateLimiter();
    const lines: string[] = [];
    const provider: EmailProvider = {
      name: 'development',
      isConfigured: () => true,
      send: async (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(
              new EmailProviderError({
                message: 'cancelled',
                kind: 'cancelled',
                provider: 'development',
                cause: signal.reason,
              }),
            );
          });
        }),
    };

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: provider,
      deliveryPolicy: fastPolicy({ providerTimeoutMs: 40, maxAttempts: 1 }),
      createLogger: (id) => createLogger(id, (line) => lines.push(line)),
      ...stubSender(),
    });

    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 503);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.PROVIDER_FAILURE);

    const failed = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'send.request.failed');
    assert.ok(failed);
    assert.equal(failed.failureCategory, 'timeout');
    assert.equal(failed.failureClass, 'transient');
  });

  it('does not retry transient failures without Idempotency-Key', async () => {
    resetSendRateLimiter();
    let calls = 0;
    const provider: EmailProvider = {
      name: 'development',
      isConfigured: () => true,
      send: async () => {
        calls += 1;
        throw new EmailProviderError({
          message: '5xx',
          kind: 'transient',
          provider: 'development',
        });
      },
    };

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: provider,
      deliveryPolicy: fastPolicy({ maxAttempts: 3 }),
      ...stubSender(),
    });

    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  });

  it('retries transient failures then succeeds when Idempotency-Key is present', async () => {
    resetSendRateLimiter();
    let calls = 0;
    const sent: EmailSendRequest[] = [];
    const provider: EmailProvider = {
      name: 'development',
      isConfigured: () => true,
      send: async (request): Promise<EmailSendResult> => {
        calls += 1;
        sent.push(request);
        if (calls < 2) {
          throw new EmailProviderError({
            message: '5xx',
            kind: 'transient',
            provider: 'development',
          });
        }
        return { providerMessageId: 'msg-ok', accepted: true };
      },
    };
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: provider,
      idempotencyStore: store,
      deliveryPolicy: fastPolicy({ maxAttempts: 3 }),
      ...stubSender(),
    });

    const response = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'retry-transient-1' },
        json: validBody(),
      }),
      fakeContext(),
    );

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(sent.length, 2);
  });

  it('does not retry permanent failures even with Idempotency-Key', async () => {
    resetSendRateLimiter();
    let calls = 0;
    const provider: EmailProvider = {
      name: 'development',
      isConfigured: () => true,
      send: async () => {
        calls += 1;
        throw new EmailProviderError({
          message: 'rejected',
          kind: 'permanent',
          provider: 'development',
        });
      },
    };
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });
    const lines: string[] = [];

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: provider,
      idempotencyStore: store,
      deliveryPolicy: fastPolicy({ maxAttempts: 3 }),
      createLogger: (id) => createLogger(id, (line) => lines.push(line)),
      ...stubSender(),
    });

    const response = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'permanent-1' },
        json: validBody(),
      }),
      fakeContext(),
    );

    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    const failed = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'send.request.failed');
    assert.ok(failed);
    assert.equal(failed.failureClass, 'permanent');
    assert.equal(failed.failureCategory, 'permanent');
  });

  it('replay after success does not call the provider again (no double-send)', async () => {
    resetSendRateLimiter();
    let calls = 0;
    const provider: EmailProvider = {
      name: 'development',
      isConfigured: () => true,
      send: async () => {
        calls += 1;
        if (calls === 1) {
          throw new EmailProviderError({
            message: '5xx',
            kind: 'transient',
            provider: 'development',
          });
        }
        return { providerMessageId: `msg-${calls}`, accepted: true };
      },
    };
    const store = new MemoryIdempotencyStore({ ttlMs: 60_000 });

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: provider,
      idempotencyStore: store,
      deliveryPolicy: fastPolicy({ maxAttempts: 3 }),
      ...stubSender(),
    });

    const first = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'replay-1', 'x-correlation-id': 'corr-first' },
        json: validBody(),
      }),
      fakeContext(),
    );
    assert.equal(first.status, 200);
    assert.equal(calls, 2);

    const second = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'replay-1', 'x-correlation-id': 'corr-second' },
        json: validBody(),
      }),
      fakeContext(),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(second.jsonBody, { id: 'corr-first', status: 'sent' });
    assert.equal(calls, 2, 'replay must not call the provider again');
  });

  it('default provider timeout sits inside the Function App limit', () => {
    const policy = resolveSendDeliveryPolicy({});
    assert.equal(policy.providerTimeoutMs, DEFAULT_SEND_PROVIDER_TIMEOUT_MS);
    assert.ok(policy.retryBudgetMs < policy.functionTimeoutMs);
  });
});
