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
import { TenantResolverError, type TenantResolver } from '../tenant';
import type { ResolvedTenantEmailConfig } from '../tenant/tenant-email-config';
import { TemplateStoreError, type TemplateStore } from '../templates';
import { resetSendRateLimiter } from '../contact-rate-limit';
import { resetSendSizeLimitsCache } from '../send-limits';
import { createLogger } from '../telemetry';
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

function fakeResolver(ok = true): TenantResolver {
  return {
    resolve: async () => {
      if (!ok) {
        throw new TenantResolverError('missing', PostKitErrorCode.UNAUTHENTICATED);
      }
      return TENANT;
    },
  };
}

function fakeStore(result: CompiledTemplate | TemplateStoreError): TemplateStore {
  return {
    load: async () => {
      if (result instanceof TemplateStoreError) throw result;
      return result;
    },
  };
}

function stubTenantSender(
  config: Partial<ResolvedTenantEmailConfig> = {},
): Pick<Parameters<typeof createSendHandler>[0], 'resolveTenantEmailConfig'> {
  return {
    resolveTenantEmailConfig: async () => ({
      fromAddress: 'noreply@example.com',
      fromDisplayName: 'PostKit',
      ...config,
    }),
  };
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

describe('sendHandler', () => {
  it('sends a template email and returns SendResponse', async () => {
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({
        headers: { authorization: 'Bearer tok', 'x-correlation-id': 'corr-send-01' },
        json: {
          template: 'marketing.contact-us',
          to: 'user@example.com',
          variables: { name: 'Ada' },
        },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.jsonBody, { id: 'corr-send-01', status: 'sent' });
    assert.equal(sent[0]?.subject, 'Hi Ada');
    assert.equal(sent[0]?.html, '<p>Hello Ada</p>');
  });

  it('HTML-escapes variables in the body', async () => {
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    await handler(
      fakeRequest({
        json: {
          template: 'marketing.contact-us',
          to: 'user@example.com',
          variables: { name: '<script>alert(1)</script>' },
        },
      }),
      fakeContext(),
    );

    assert.ok(sent[0]?.html?.includes('&lt;script&gt;'));
    assert.ok(!sent[0]?.html?.includes('<script>'));
  });

  it('returns 401 UNAUTHENTICATED', async () => {
    const handler = createSendHandler({
      tenantResolver: fakeResolver(false),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest({ json: {} }), fakeContext());
    assert.equal(response.status, 401);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.UNAUTHENTICATED);
    assert.equal(typeof (response.jsonBody as { correlationId: string }).correlationId, 'string');
  });

  it('returns 403 UNAUTHORIZED', async () => {
    const handler = createSendHandler({
      tenantResolver: {
        resolve: async () => {
          throw new TenantResolverError('unknown', PostKitErrorCode.UNAUTHORIZED);
        },
      },
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 403);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.UNAUTHORIZED);
  });

  it('returns 404 TEMPLATE_NOT_FOUND', async () => {
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(
        new TemplateStoreError('missing', PostKitErrorCode.TEMPLATE_NOT_FOUND),
      ),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 404);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.TEMPLATE_NOT_FOUND);
  });

  it('returns 400 INVALID_TEMPLATE from store', async () => {
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(new TemplateStoreError('bad', PostKitErrorCode.INVALID_TEMPLATE)),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.INVALID_TEMPLATE);
  });

  it('returns 400 MISSING_VARIABLES', async () => {
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(
      fakeRequest({
        json: { template: 'marketing.contact-us', to: 'user@example.com', variables: {} },
      }),
      fakeContext(),
    );
    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.MISSING_VARIABLES);
  });

  it('returns 400 INVALID_RECIPIENT', async () => {
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(
      fakeRequest({
        json: { template: 'marketing.contact-us', to: 'not-an-email', variables: { name: 'Ada' } },
      }),
      fakeContext(),
    );
    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.INVALID_RECIPIENT);
  });

  it('rejects unsafe template keys before loading the store', async () => {
    let loaded = false;
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: {
        load: async () => {
          loaded = true;
          return COMPILED;
        },
      },
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(
      fakeRequest({
        json: { template: '../etc/passwd', to: 'user@example.com', variables: { name: 'Ada' } },
      }),
      fakeContext(),
    );
    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.INVALID_TEMPLATE);
    assert.equal(loaded, false);
  });

  it('allows branding defaults to satisfy required variables', async () => {
    const sent: EmailSendRequest[] = [];
    const withBrandingVar: CompiledTemplate = {
      ...COMPILED,
      templateHtml: '<p>{{companyName}}</p>',
      metadata: {
        ...COMPILED.metadata,
        subject: 'From {{companyName}}',
        variables: ['companyName'],
      },
      manifest: { ...COMPILED.manifest, variables: ['companyName'] },
    };
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(withBrandingVar),
      emailProvider: fakeProvider(sent),
      resolveBranding: async () => ({ companyName: 'InkAds' }),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({
        json: {
          template: 'marketing.contact-us',
          to: 'user@example.com',
          variables: {},
        },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 200);
    assert.equal(sent[0]?.subject, 'From InkAds');
    assert.equal(sent[0]?.html, '<p>InkAds</p>');
  });

  it('emits the full structured log contract on success', async () => {
    const lines: string[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
      createLogger: (correlationId) => createLogger(correlationId, (line) => lines.push(line)),
    });

    await handler(
      fakeRequest({
        headers: { 'x-correlation-id': 'corr-log-success' },
        json: validBody(),
      }),
      fakeContext(),
    );

    const completed = lines
      .map((l) => JSON.parse(l))
      .find((e) => e.msg === 'send.request.completed');
    assert.ok(completed, 'send.request.completed must be logged');
    assert.equal(completed.correlationId, 'corr-log-success');
    assert.equal(completed.tenantId, 'inkads');
    assert.equal(completed.environment, 'development');
    assert.equal(completed.templateKey, 'marketing.contact-us');
    assert.equal(completed.outcome, 'sent');
    assert.equal(typeof completed.durationMs, 'number');
    assert.equal(completed.providerMessageId, 'msg-1');
    assert.equal(typeof completed.recipientHash, 'string');
    assert.equal(completed.recipientHash.length, 16);
    assert.ok(!('failureCategory' in completed));
    assert.ok(!JSON.stringify(completed).includes('user@example.com'));
    assert.ok(!JSON.stringify(completed).includes('Ada'));
  });

  it('emits the full structured log contract on validation failure', async () => {
    const lines: string[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
      createLogger: (correlationId) => createLogger(correlationId, (line) => lines.push(line)),
    });

    await handler(
      fakeRequest({
        headers: { 'x-correlation-id': 'corr-log-validation' },
        json: { template: 'marketing.contact-us', to: 'user@example.com', variables: {} },
      }),
      fakeContext(),
    );

    const failed = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'send.request.failed');
    assert.ok(failed);
    assert.equal(failed.correlationId, 'corr-log-validation');
    assert.equal(failed.tenantId, 'inkads');
    assert.equal(failed.environment, 'development');
    assert.equal(failed.templateKey, 'marketing.contact-us');
    assert.equal(failed.outcome, 'validation_error');
    assert.equal(failed.errorCode, PostKitErrorCode.MISSING_VARIABLES);
    assert.equal(failed.failureCategory, 'missing_variables');
    assert.equal(typeof failed.durationMs, 'number');
    assert.equal(typeof failed.recipientHash, 'string');
    assert.ok(!JSON.stringify(failed).includes('user@example.com'));
  });

  it('emits templateKey and recipientHash when variables validation fails after template and recipient succeed', async () => {
    const lines: string[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
      createLogger: (correlationId) => createLogger(correlationId, (line) => lines.push(line)),
    });

    await handler(
      fakeRequest({
        headers: { 'x-correlation-id': 'corr-log-variables-null' },
        json: { template: 'marketing.contact-us', to: 'user@example.com', variables: null },
      }),
      fakeContext(),
    );

    const failed = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'send.request.failed');
    assert.ok(failed);
    assert.equal(failed.templateKey, 'marketing.contact-us');
    assert.equal(failed.errorCode, PostKitErrorCode.MISSING_VARIABLES);
    assert.equal(typeof failed.recipientHash, 'string');
    assert.equal(failed.recipientHash.length, 16);
    assert.ok(!JSON.stringify(failed).includes('user@example.com'));
  });

  it('emits provider failureCategory and providerRequestId on provider errors', async () => {
    const { EmailProviderError } = await import('@singleton-sd/post-kit-email');
    const lines: string[] = [];
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: {
        name: 'development',
        isConfigured: () => true,
        send: async () => {
          throw new EmailProviderError({
            message: 'boom',
            kind: 'permanent',
            provider: 'development',
            providerRequestId: 'req-42',
          });
        },
      },
      ...stubTenantSender(),
      createLogger: (correlationId) => createLogger(correlationId, (line) => lines.push(line)),
    });

    await handler(fakeRequest({ json: validBody() }), fakeContext());

    const failed = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'send.request.failed');
    assert.ok(failed);
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.failureCategory, 'permanent');
    assert.equal(failed.providerRequestId, 'req-42');
    assert.ok(!('providerMessageId' in failed));
    assert.equal(failed.environment, 'development');
    assert.ok(!JSON.stringify(failed).includes('user@example.com'));
    assert.ok(!JSON.stringify(failed).includes('Ada'));
  });

  it('returns 429 RATE_LIMITED with Retry-After when the tenant exceeds the send limit', async () => {
    resetSendRateLimiter();
    process.env.SEND_RATE_LIMIT_PER_MIN = '1';
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    const body = validBody();
    const first = await handler(fakeRequest({ json: body }), fakeContext());
    assert.equal(first.status, 200);

    const second = await handler(fakeRequest({ json: body }), fakeContext());
    assert.equal(second.status, 429);
    assert.equal((second.jsonBody as { code: string }).code, PostKitErrorCode.RATE_LIMITED);
    assert.ok(Number((second.headers as Record<string, string>)['Retry-After']) >= 1);
    delete process.env.SEND_RATE_LIMIT_PER_MIN;
    resetSendRateLimiter();
  });

  it('isolates rate limits per tenant', async () => {
    resetSendRateLimiter();
    process.env.SEND_RATE_LIMIT_PER_MIN = '1';
    const tenantB: TenantResolver = {
      resolve: async () => ({ tenantId: 'other', environment: 'development' }),
    };
    const handlerA = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const handlerB = createSendHandler({
      tenantResolver: tenantB,
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    assert.equal((await handlerA(fakeRequest({ json: validBody() }), fakeContext())).status, 200);
    assert.equal((await handlerB(fakeRequest({ json: validBody() }), fakeContext())).status, 200);
    assert.equal((await handlerA(fakeRequest({ json: validBody() }), fakeContext())).status, 429);
    delete process.env.SEND_RATE_LIMIT_PER_MIN;
    resetSendRateLimiter();
  });

  it('rejects oversized request bodies before template load', async () => {
    resetSendSizeLimitsCache();
    process.env.SEND_MAX_BODY_BYTES = '50';
    let loaded = false;
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: {
        load: async () => {
          loaded = true;
          return COMPILED;
        },
      },
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({
        json: {
          template: 'marketing.contact-us',
          to: 'user@example.com',
          variables: { name: 'a'.repeat(100) },
        },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.PAYLOAD_TOO_LARGE);
    assert.match((response.jsonBody as { error: string }).error, /50/);
    assert.equal(loaded, false);
    delete process.env.SEND_MAX_BODY_BYTES;
    resetSendSizeLimitsCache();
  });

  it('rejects oversized variable values with PAYLOAD_TOO_LARGE', async () => {
    resetSendSizeLimitsCache();
    process.env.SEND_MAX_VARIABLE_VALUE_BYTES = '10';
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({
        json: {
          template: 'marketing.contact-us',
          to: 'user@example.com',
          variables: { name: '12345678901' },
        },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 400);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.PAYLOAD_TOO_LARGE);
    assert.match((response.jsonBody as { error: string }).error, /name/);
    delete process.env.SEND_MAX_VARIABLE_VALUE_BYTES;
    resetSendSizeLimitsCache();
  });

  it('returns PROVIDER_FAILURE when the provider throws', async () => {
    const { EmailProviderError } = await import('@singleton-sd/post-kit-email');
    const handler = createSendHandler({
      tenantResolver: fakeResolver(),
      templateStore: fakeStore(COMPILED),
      emailProvider: {
        name: 'development',
        isConfigured: () => true,
        send: async () => {
          throw new EmailProviderError({
            message: 'boom',
            kind: 'permanent',
            provider: 'development',
          });
        },
      },
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest({ json: validBody() }), fakeContext());
    assert.equal(response.status, 502);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.PROVIDER_FAILURE);
  });
});

function validBody() {
  return {
    template: 'marketing.contact-us',
    to: 'user@example.com',
    variables: { name: 'Ada' },
  };
}
