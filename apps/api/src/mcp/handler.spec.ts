import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import {
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import { ApiKeyTenantResolver } from '../tenant';
import { TemplateStoreError, type TemplateStore } from '../templates';
import { createMcpHandler } from './handler';

const TENANT: TenantContext = { tenantId: 'acme', environment: 'development' };
const TOKEN = 'tk_dev_test';

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>Hi</p>',
  metadata: {
    key: 'ops.ping',
    name: 'Ping',
    subject: 'Ping',
    variables: [],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 'ops.ping',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '',
    sourceCommit: '',
    variables: [],
    contentHash: '',
  },
};

function fakeStore(): TemplateStore {
  return {
    list: async () => [{ key: 'ops.ping', name: 'Ping', variables: [] }],
    load: async () => COMPILED,
  };
}

function fakeRequest(options: {
  method?: string;
  authorization?: string | null;
  body?: unknown;
}): HttpRequest {
  const headers = new Map<string, string>();
  if (options.authorization !== null && options.authorization !== undefined) {
    headers.set('authorization', options.authorization);
  } else if (options.authorization === undefined) {
    headers.set('authorization', `Bearer ${TOKEN}`);
  }
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json, text/event-stream');

  const bodyText =
    options.body === undefined
      ? ''
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);

  return {
    method: options.method ?? 'POST',
    url: 'http://localhost:7071/mcp',
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      [Symbol.iterator]: function* () {
        for (const [k, v] of headers) {
          yield [k, v] as [string, string];
        }
      },
    },
    text: async () => bodyText,
    arrayBuffer: async () => Buffer.from(bodyText, 'utf8'),
    json: async () => (bodyText ? JSON.parse(bodyText) : null),
  } as unknown as HttpRequest;
}

const context = {
  error: () => undefined,
  log: () => undefined,
} as unknown as InvocationContext;

describe('createMcpHandler', () => {
  it('rejects missing Bearer credentials with 401', async () => {
    const handler = createMcpHandler({
      tenantResolver: new ApiKeyTenantResolver({
        [TOKEN]: { tenantId: TENANT.tenantId, environment: TENANT.environment },
      }),
      templateStore: fakeStore(),
    });

    const response = await handler(
      fakeRequest({ authorization: null, body: { jsonrpc: '2.0', method: 'initialize', id: 1 } }),
      context,
    );
    assert.equal(response.status, 401);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.UNAUTHENTICATED);
  });

  it('rejects unknown Bearer credentials with 403', async () => {
    const handler = createMcpHandler({
      tenantResolver: new ApiKeyTenantResolver({
        [TOKEN]: { tenantId: TENANT.tenantId, environment: TENANT.environment },
      }),
      templateStore: fakeStore(),
    });

    const response = await handler(
      fakeRequest({
        authorization: 'Bearer wrong',
        body: { jsonrpc: '2.0', method: 'initialize', id: 1 },
      }),
      context,
    );
    assert.equal(response.status, 403);
    assert.equal((response.jsonBody as { code: string }).code, PostKitErrorCode.UNAUTHORIZED);
  });

  it('returns 405 for GET (stateless JSON mode — no SSE standalone stream)', async () => {
    const handler = createMcpHandler({
      tenantResolver: new ApiKeyTenantResolver({
        [TOKEN]: { tenantId: TENANT.tenantId, environment: TENANT.environment },
      }),
      templateStore: fakeStore(),
    });
    const response = await handler(fakeRequest({ method: 'GET' }), context);
    assert.equal(response.status, 405);
  });

  it('accepts initialize over POST with valid credentials', async () => {
    const handler = createMcpHandler({
      tenantResolver: new ApiKeyTenantResolver({
        [TOKEN]: { tenantId: TENANT.tenantId, environment: TENANT.environment },
      }),
      templateStore: fakeStore(),
    });

    const response = await handler(
      fakeRequest({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        },
      }),
      context,
    );

    assert.equal(response.status, 200);
    const body =
      typeof response.body === 'string'
        ? response.body
        : Buffer.isBuffer(response.body)
          ? response.body.toString('utf8')
          : '';
    assert.ok(body.includes('post-kit') || body.includes('serverInfo') || body.includes('result'));
  });

  it('does not call template store for auth failures', async () => {
    let listed = false;
    const store: TemplateStore = {
      list: async () => {
        listed = true;
        return [];
      },
      load: async () => {
        throw new TemplateStoreError('unused', PostKitErrorCode.TEMPLATE_NOT_FOUND);
      },
    };
    const handler = createMcpHandler({
      tenantResolver: new ApiKeyTenantResolver({}),
      templateStore: store,
    });
    await handler(fakeRequest({ authorization: `Bearer ${TOKEN}`, body: {} }), context);
    assert.equal(listed, false);
  });
});
