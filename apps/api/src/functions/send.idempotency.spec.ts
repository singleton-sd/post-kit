import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import type {
  EmailProvider,
  EmailSendRequest,
  EmailSendResult,
} from '@singleton-sd/post-kit-email';
import {
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { MemoryIdempotencyStore } from '../idempotency';
import { resetSendRateLimiter } from '../contact-rate-limit';
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

function fakeResolver(tenant: TenantContext = TENANT): TenantResolver {
  return { resolve: async () => tenant };
}

function fakeStore(): TemplateStore {
  return { load: async () => COMPILED };
}

function fakeProvider(capture?: EmailSendRequest[]): EmailProvider {
  return {
    name: 'development',
    isConfigured: () => true,
    send: async (request): Promise<EmailSendResult> => {
      capture?.push(request);
      return { providerMessageId: 'msg-1', accepted: true };
    },
  };
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

describe('sendHandler idempotency', () => {
  it('without Idempotency-Key keeps at-least-once behaviour (provider called each time)', async () => {
    resetSendRateLimiter();
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: fakeProvider(sent),
      idempotencyStore: new MemoryIdempotencyStore(),
      ...stubSender(),
    });

    assert.equal((await handler(fakeRequest({ json: validBody() }), fakeContext())).status, 200);
    assert.equal((await handler(fakeRequest({ json: validBody() }), fakeContext())).status, 200);
    assert.equal(sent.length, 2);
  });

  it('replays a completed request without a second provider call', async () => {
    resetSendRateLimiter();
    const sent: EmailSendRequest[] = [];
    const store = new MemoryIdempotencyStore();
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: fakeProvider(sent),
      idempotencyStore: store,
      ...stubSender(),
    });

    const first = await handler(
      fakeRequest({
        headers: {
          authorization: 'Bearer tok',
          'idempotency-key': 'retry-abc',
          'x-correlation-id': 'corr-first-01',
        },
        json: validBody(),
      }),
      fakeContext(),
    );
    assert.equal(first.status, 200);
    assert.deepEqual(first.jsonBody, { id: 'corr-first-01', status: 'sent' });
    assert.equal(sent.length, 1);

    const second = await handler(
      fakeRequest({
        headers: {
          authorization: 'Bearer tok',
          'idempotency-key': 'retry-abc',
          'x-correlation-id': 'corr-second-02',
        },
        json: validBody(),
      }),
      fakeContext(),
    );
    assert.equal(second.status, 200);
    assert.deepEqual(second.jsonBody, { id: 'corr-first-01', status: 'sent' });
    assert.equal(sent.length, 1);
  });

  it('returns IDEMPOTENCY_IN_PROGRESS while the first request is in flight', async () => {
    resetSendRateLimiter();
    const store = new MemoryIdempotencyStore();
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });

    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: {
        name: 'development',
        isConfigured: () => true,
        send: async () => {
          await sendGate;
          return { providerMessageId: 'msg-1', accepted: true };
        },
      },
      idempotencyStore: store,
      ...stubSender(),
    });

    const firstPromise = handler(
      fakeRequest({
        headers: { 'idempotency-key': 'inflight-1', 'x-correlation-id': 'corr-inflight-a' },
        json: validBody(),
      }),
      fakeContext(),
    );

    // Allow the first handler to claim and block inside provider.send.
    await new Promise((r) => setTimeout(r, 20));

    const concurrent = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'inflight-1', 'x-correlation-id': 'corr-inflight-b' },
        json: validBody(),
      }),
      fakeContext(),
    );

    assert.equal(concurrent.status, 409);
    assert.equal(
      (concurrent.jsonBody as { code: string }).code,
      PostKitErrorCode.IDEMPOTENCY_IN_PROGRESS,
    );

    releaseSend();
    const first = await firstPromise;
    assert.equal(first.status, 200);
  });

  it('treats the same key from a different tenant as a distinct request', async () => {
    resetSendRateLimiter();
    const sent: EmailSendRequest[] = [];
    const store = new MemoryIdempotencyStore();
    const other: TenantContext = { tenantId: 'other', environment: 'development' };

    const handlerA = createSendHandler({
      tenantResolver: fakeResolver(TENANT),
      templateStore: fakeStore(),
      emailProvider: fakeProvider(sent),
      idempotencyStore: store,
      ...stubSender(),
    });
    const handlerB = createSendHandler({
      tenantResolver: fakeResolver(other),
      templateStore: fakeStore(),
      emailProvider: fakeProvider(sent),
      idempotencyStore: store,
      ...stubSender(),
    });

    assert.equal(
      (
        await handlerA(
          fakeRequest({ headers: { 'idempotency-key': 'shared-key' }, json: validBody() }),
          fakeContext(),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await handlerB(
          fakeRequest({ headers: { 'idempotency-key': 'shared-key' }, json: validBody() }),
          fakeContext(),
        )
      ).status,
      200,
    );
    assert.equal(sent.length, 2);
  });

  it('rejects unsafe Idempotency-Key values before touching the store', async () => {
    resetSendRateLimiter();
    let beginCalled = false;
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(),
      emailProvider: fakeProvider(),
      idempotencyStore: {
        begin: async () => {
          beginCalled = true;
          return { outcome: 'claimed' };
        },
        complete: async () => undefined,
        release: async () => undefined,
      },
      ...stubSender(),
    });

    const response = await handler(
      fakeRequest({
        headers: { 'idempotency-key': 'bad key with spaces' },
        json: validBody(),
      }),
      fakeContext(),
    );

    assert.equal(response.status, 400);
    assert.match((response.jsonBody as { error: string }).error, /invalid characters/i);
    assert.equal(beginCalled, false);
  });
});
