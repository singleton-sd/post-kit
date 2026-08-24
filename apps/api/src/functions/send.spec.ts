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
import { TemplateStoreError, type TemplateStore } from '../templates';
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
  return {
    method: 'POST',
    headers: { get: (name: string) => headers.get(name) },
    json: async () => options.json ?? null,
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
      fromAddress: () => 'noreply@example.com',
      fromName: () => 'PostKit',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
      fromAddress: () => 'noreply@example.com',
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
