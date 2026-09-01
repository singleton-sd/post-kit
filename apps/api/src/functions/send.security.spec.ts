import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { EmailProvider, EmailSendRequest } from '@singleton-sd/post-kit-email';
import {
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { ApiKeyTenantResolver, type TenantKeyMap } from '../tenant';
import type { ResolvedTenantEmailConfig } from '../tenant/tenant-email-config';
import type { TemplateStore } from '../templates';
import { createSendHandler } from './send';

/**
 * Security boundary tests for the send handler (issue #41).
 *
 * Deliberately kept in a separate file from `send.spec.ts` so concurrent work
 * on that suite merges cleanly. No live Azure calls: the tenant resolver,
 * template store and email provider are all fakes.
 */

const TEMPLATE_KEY = 'marketing.contact-us';

const KEY_MAP: TenantKeyMap = {
  tk_a_prod: { tenantId: 'tenant-a', environment: 'production' },
  tk_a_dev: { tenantId: 'tenant-a', environment: 'development' },
  tk_b_prod: { tenantId: 'tenant-b', environment: 'production' },
};

function compiledFor(html: string, variables: string[] = ['name']): CompiledTemplate {
  return {
    templateHtml: html,
    metadata: {
      key: TEMPLATE_KEY,
      name: 'Contact Us',
      subject: 'Hi {{name}}',
      variables,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    },
    manifest: {
      key: TEMPLATE_KEY,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      compiledAt: '2026-01-01T00:00:00.000Z',
      sourceCommit: '',
      variables,
      contentHash: 'hash',
    },
  };
}

function fakeRequest(options: {
  headers?: Record<string, string>;
  json?: unknown;
  jsonError?: Error;
  text?: string;
  textError?: Error;
}): HttpRequest {
  const headers = new Headers(options.headers);
  const jsonBody = options.json ?? null;
  const textBody =
    options.text !== undefined ? options.text : jsonBody === null ? '' : JSON.stringify(jsonBody);
  return {
    method: 'POST',
    headers: { get: (name: string) => headers.get(name) },
    json: async () => {
      if (options.jsonError) throw options.jsonError;
      return jsonBody;
    },
    text: async () => {
      if (options.textError) throw options.textError;
      return textBody;
    },
  } as unknown as HttpRequest;
}

function fakeContext(): InvocationContext {
  return { error: () => undefined } as unknown as InvocationContext;
}

interface LoadCall {
  tenant: TenantContext;
  key: string;
}

/**
 * Template store whose artifacts are owned by a specific tenant + environment.
 * A load for any other tenant/environment behaves exactly like a missing blob.
 */
function tenantScopedStore(
  owner: TenantContext,
  html: string,
  calls: LoadCall[],
): { store: TemplateStore } {
  return {
    store: {
      load: async (tenant, key) => {
        calls.push({ tenant, key });
        if (tenant.tenantId !== owner.tenantId || tenant.environment !== owner.environment) {
          const { TemplateStoreError } = await import('../templates');
          throw new TemplateStoreError('not found', PostKitErrorCode.TEMPLATE_NOT_FOUND);
        }
        return compiledFor(html);
      },
    },
  };
}

function stubTenantSender(
  config: Partial<ResolvedTenantEmailConfig> = {},
): Pick<Parameters<typeof createSendHandler>[0], 'resolveTenantEmailConfig'> {
  return {
    resolveTenantEmailConfig: async () => ({
      fromAddress: 'noreply@example.com',
      ...config,
    }),
  };
}

function fakeProvider(capture?: EmailSendRequest[]): EmailProvider {
  return {
    name: 'development',
    isConfigured: () => true,
    send: async (request) => {
      capture?.push(request);
      return { providerMessageId: 'msg-1', accepted: true };
    },
  };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template: TEMPLATE_KEY,
    to: 'user@example.com',
    variables: { name: 'Ada' },
    ...overrides,
  };
}

function errorCode(response: { jsonBody?: unknown }): string {
  return (response.jsonBody as { code: string }).code;
}

describe('sendHandler — cross-tenant isolation', () => {
  it('does not serve a tenant B template to a tenant A credential', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-b', environment: 'production' },
      '<p>tenant-b secret</p>',
      calls,
    );
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({ headers: { authorization: 'Bearer tk_a_prod' }, json: body() }),
      fakeContext(),
    );

    assert.equal(response.status, 404);
    assert.equal(errorCode(response), PostKitErrorCode.TEMPLATE_NOT_FOUND);
    assert.deepEqual(calls[0]?.tenant, { tenantId: 'tenant-a', environment: 'production' });
    assert.equal(sent.length, 0, 'no email may be sent for a foreign template');
  });

  it('serves the tenant that owns the template', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-b', environment: 'production' },
      '<p>tenant-b</p>',
      calls,
    );
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({ headers: { authorization: 'Bearer tk_b_prod' }, json: body() }),
      fakeContext(),
    );

    assert.equal(response.status, 200);
    assert.equal(sent[0]?.html, '<p>tenant-b</p>');
  });

  it('does not leak the foreign tenant id or template content in the error body', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-b', environment: 'production' },
      '<p>tenant-b secret</p>',
      calls,
    );
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({ headers: { authorization: 'Bearer tk_a_prod' }, json: body() }),
      fakeContext(),
    );

    const serialized = JSON.stringify(response.jsonBody);
    assert.ok(!serialized.includes('secret'), 'error body must not echo template content');
    assert.ok(!serialized.includes('tk_a_prod'), 'error body must not echo the credential');
  });
});

describe('sendHandler — tenant spoofing has no effect', () => {
  const spoofAttempts: Array<[label: string, options: Parameters<typeof fakeRequest>[0]]> = [
    [
      'tenantId in the body',
      {
        headers: { authorization: 'Bearer tk_a_prod' },
        json: body({ tenantId: 'tenant-b', environment: 'production' }),
      },
    ],
    [
      'tenant headers',
      {
        headers: {
          authorization: 'Bearer tk_a_prod',
          'x-tenant-id': 'tenant-b',
          'x-postkit-tenant': 'tenant-b',
          'x-environment': 'development',
        },
        json: body(),
      },
    ],
    [
      'nested tenant claim in variables',
      {
        headers: { authorization: 'Bearer tk_a_prod' },
        json: body({ variables: { name: 'Ada', tenantId: 'tenant-b' } }),
      },
    ],
  ];

  for (const [label, options] of spoofAttempts) {
    it(`ignores ${label} and resolves the tenant from the credential only`, async () => {
      const calls: LoadCall[] = [];
      const { store } = tenantScopedStore(
        { tenantId: 'tenant-a', environment: 'production' },
        '<p>Hello {{name}}</p>',
        calls,
      );
      const handler = createSendHandler({
        tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
        templateStore: store,
        emailProvider: fakeProvider(),
        ...stubTenantSender(),
      });

      const response = await handler(fakeRequest(options), fakeContext());

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]?.tenant, { tenantId: 'tenant-a', environment: 'production' });
    });
  }

  it('rejects a request that carries only spoofed tenant claims and no credential', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-a', environment: 'production' },
      '<p>Hello {{name}}</p>',
      calls,
    );
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({
        headers: { 'x-tenant-id': 'tenant-a' },
        json: body({ tenantId: 'tenant-a' }),
      }),
      fakeContext(),
    );

    assert.equal(response.status, 401);
    assert.equal(errorCode(response), PostKitErrorCode.UNAUTHENTICATED);
    assert.equal(calls.length, 0, 'the store must not be touched without a credential');
  });
});

describe('sendHandler — environment isolation', () => {
  it('does not serve production artifacts to a development credential', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-a', environment: 'production' },
      '<p>prod</p>',
      calls,
    );
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    const response = await handler(
      fakeRequest({ headers: { authorization: 'Bearer tk_a_dev' }, json: body() }),
      fakeContext(),
    );

    assert.equal(response.status, 404);
    assert.equal(errorCode(response), PostKitErrorCode.TEMPLATE_NOT_FOUND);
    assert.deepEqual(calls[0]?.tenant, { tenantId: 'tenant-a', environment: 'development' });
    assert.equal(sent.length, 0);
  });
});

describe('sendHandler — unsafe template keys are rejected before storage access', () => {
  const unsafeKeys: Array<[label: string, key: unknown]> = [
    ['parent traversal', '../tenant-b/production/templates/x'],
    ['nested traversal', 'a/../../b'],
    ['absolute path', '/etc/passwd'],
    ['windows absolute path', 'C:\\secrets'],
    ['URL-encoded traversal', '%2e%2e%2ftenant-b'],
    ['double URL-encoded traversal', '%252e%252e%252f'],
    ['empty segment', 'a//b'],
    ['trailing slash', `${TEMPLATE_KEY}/`],
    ['null byte', `${TEMPLATE_KEY}\u0000.html`],
    ['newline', `${TEMPLATE_KEY}\ntemplate`],
    ['backslash traversal', '..\\tenant-b'],
    ['whitespace', 'contact us'],
    ['wildcard', 'contact-*'],
    ['query string', `${TEMPLATE_KEY}?snapshot=1`],
    ['bare dot', '.'],
    ['bare dot-dot', '..'],
    ['blank string', '   '],
    ['non-string key', { key: TEMPLATE_KEY }],
    ['array key', [TEMPLATE_KEY]],
    ['numeric key', 42],
  ];

  for (const [label, key] of unsafeKeys) {
    it(`rejects ${label} with 400 INVALID_TEMPLATE and no store access`, async () => {
      const calls: LoadCall[] = [];
      const { store } = tenantScopedStore(
        { tenantId: 'tenant-a', environment: 'production' },
        '<p>Hello {{name}}</p>',
        calls,
      );
      const handler = createSendHandler({
        tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
        templateStore: store,
        emailProvider: fakeProvider(),
        ...stubTenantSender(),
      });

      const response = await handler(
        fakeRequest({
          headers: { authorization: 'Bearer tk_a_prod' },
          json: body({ template: key }),
        }),
        fakeContext(),
      );

      assert.equal(response.status, 400);
      assert.equal(errorCode(response), PostKitErrorCode.INVALID_TEMPLATE);
      assert.deepEqual(calls, [], 'no storage access may happen for an unsafe key');
    });
  }
});

describe('sendHandler — hostile variable values cannot inject markup', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    "<img src=x onerror=alert('xss')>',",
    '<iframe src="javascript:alert(1)"></iframe>',
    '</p><style>body{display:none}</style><p>',
    '{{constructor}}',
    '{{#each this}}{{/each}}',
  ];

  for (const payload of payloads) {
    it(`escapes ${JSON.stringify(payload)} in subject and body`, async () => {
      const calls: LoadCall[] = [];
      const { store } = tenantScopedStore(
        { tenantId: 'tenant-a', environment: 'production' },
        '<p>Hello {{name}}</p>',
        calls,
      );
      const sent: EmailSendRequest[] = [];
      const handler = createSendHandler({
        tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
        templateStore: store,
        emailProvider: fakeProvider(sent),
        ...stubTenantSender(),
      });

      const response = await handler(
        fakeRequest({
          headers: { authorization: 'Bearer tk_a_prod' },
          json: body({ variables: { name: payload } }),
        }),
        fakeContext(),
      );

      assert.equal(response.status, 200);
      const html = sent[0]?.html ?? '';
      const subject = sent[0]?.subject ?? '';
      for (const rendered of [html, subject]) {
        assert.ok(!rendered.includes('<script'), 'no raw <script> may reach the output');
        assert.ok(!rendered.includes('<iframe'), 'no raw <iframe> may reach the output');
        assert.ok(!rendered.includes('<img'), 'no raw <img> may reach the output');
        assert.ok(!rendered.includes('<style'), 'no raw <style> may reach the output');
      }
      if (payload.includes('<')) {
        assert.ok(html.includes('&lt;'), 'angle brackets must be entity-encoded');
      }
      // Injected Handlebars syntax must not be re-evaluated.
      assert.ok(!html.includes('[object'), 'variables must not be interpreted as expressions');
    });
  }

  it('escapes double quotes so a value cannot break out of an HTML attribute', async () => {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-a', environment: 'production' },
      '<a href="/p" title="{{name}}">link</a>',
      calls,
    );
    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(sent),
      ...stubTenantSender(),
    });

    await handler(
      fakeRequest({
        headers: { authorization: 'Bearer tk_a_prod' },
        json: body({ variables: { name: '" onmouseover="alert(1)' } }),
      }),
      fakeContext(),
    );

    const html = sent[0]?.html ?? '';
    assert.ok(html.includes('&quot;'), 'double quotes must be entity-encoded');
    assert.ok(!html.includes('" onmouseover='), 'attribute breakout must not be possible');
  });
});

describe('sendHandler — malformed and oversized bodies produce stable typed errors', () => {
  async function respondTo(options: Parameters<typeof fakeRequest>[0]) {
    const calls: LoadCall[] = [];
    const { store } = tenantScopedStore(
      { tenantId: 'tenant-a', environment: 'production' },
      '<p>Hello {{name}}</p>',
      calls,
    );
    const handler = createSendHandler({
      tenantResolver: new ApiKeyTenantResolver(KEY_MAP),
      templateStore: store,
      emailProvider: fakeProvider(),
      ...stubTenantSender(),
    });
    const response = await handler(fakeRequest(options), fakeContext());
    return { response, calls };
  }

  const auth = { authorization: 'Bearer tk_a_prod' };

  it('returns a typed 400 when the body is not valid JSON', async () => {
    const { response, calls } = await respondTo({
      headers: auth,
      jsonError: new SyntaxError('Unexpected token < in JSON at position 0'),
    });
    assert.equal(response.status, 400);
    assert.equal(errorCode(response), PostKitErrorCode.INVALID_RECIPIENT);
    assert.deepEqual(calls, []);
  });

  it('returns a typed 400 when the request body exceeds the payload limit', async () => {
    const { response } = await respondTo({
      headers: auth,
      text: 'x'.repeat(300_000),
    });
    assert.equal(response.status, 400);
    assert.equal(errorCode(response), PostKitErrorCode.PAYLOAD_TOO_LARGE);
  });

  it('returns a typed 400 for an oversized but well-formed variable payload', async () => {
    const { response } = await respondTo({
      headers: auth,
      json: body({ variables: { name: 'a'.repeat(200_000) } }),
    });
    assert.equal(response.status, 400);
    assert.equal(errorCode(response), PostKitErrorCode.PAYLOAD_TOO_LARGE);
  });

  const malformedBodies: Array<[label: string, value: unknown, code: PostKitErrorCode]> = [
    ['null body', null, PostKitErrorCode.INVALID_RECIPIENT],
    ['array body', [body()], PostKitErrorCode.INVALID_RECIPIENT],
    ['string body', 'template=marketing.contact-us', PostKitErrorCode.INVALID_RECIPIENT],
    ['number body', 42, PostKitErrorCode.INVALID_RECIPIENT],
    ['empty object', {}, PostKitErrorCode.INVALID_TEMPLATE],
    ['array variables', { ...body(), variables: [] }, PostKitErrorCode.MISSING_VARIABLES],
    ['null variables', { ...body(), variables: null }, PostKitErrorCode.MISSING_VARIABLES],
    [
      'non-string variable value',
      { ...body(), variables: { name: { nested: true } } },
      PostKitErrorCode.MISSING_VARIABLES,
    ],
    [
      'missing recipient',
      { template: TEMPLATE_KEY, variables: {} },
      PostKitErrorCode.INVALID_RECIPIENT,
    ],
  ];

  for (const [label, value, code] of malformedBodies) {
    it(`returns 400 ${code} for a ${label}`, async () => {
      const { response, calls } = await respondTo({ headers: auth, json: value });
      assert.equal(response.status, 400);
      assert.equal(errorCode(response), code);
      assert.deepEqual(calls, [], 'malformed bodies must not reach the store');
    });
  }

  it('always includes a correlation id on error responses', async () => {
    const { response } = await respondTo({ headers: auth, json: {} });
    assert.equal(
      typeof (response.jsonBody as { correlationId: string }).correlationId,
      'string',
      'errors must carry a correlation id',
    );
  });

  it('does not throw an unhandled exception for a prototype-polluting body', async () => {
    const { response } = await respondTo({
      headers: auth,
      json: JSON.parse('{"__proto__":{"polluted":true},"template":"' + TEMPLATE_KEY + '"}'),
    });
    assert.equal(response.status, 400);
    assert.equal(
      ({} as Record<string, unknown>)['polluted'],
      undefined,
      'Object.prototype must not be polluted',
    );
  });
});
