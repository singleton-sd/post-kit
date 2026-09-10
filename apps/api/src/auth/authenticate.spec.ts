import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { HttpRequest } from '@azure/functions';
import { DEFAULT_POC_SCOPES, PostKitErrorCode, type Principal } from '@singleton-sd/post-kit-types';
import {
  ApiKeyAuthenticator,
  AuthError,
  extractBearerToken,
  principalFromTenantKeyMap,
  principalIdFromApiKey,
  requireScope,
  tenantContextFromPrincipal,
} from './authenticate';
import { MCP_TOOL_SCOPES, scopeForMcpTool } from './mcp-scopes';

const KEY_MAP = {
  tk_live_abc123: { tenantId: 'inkads', environment: 'production' as const },
  tk_dev_xyz789: { tenantId: 'inkads', environment: 'development' as const },
};

function makeRequest(headers: Record<string, string | undefined>): HttpRequest {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) map.set(k.toLowerCase(), v);
  }
  return {
    headers: {
      get: (name: string) => map.get(name.toLowerCase()) ?? null,
    },
  } as unknown as HttpRequest;
}

describe('principalIdFromApiKey', () => {
  it('returns a truncated sha256 prefix and never equals the raw token', () => {
    const token = 'tk_live_abc123';
    const id = principalIdFromApiKey(token);
    const expected = `ak_${createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16)}`;
    assert.equal(id, expected);
    assert.notEqual(id, token);
    assert.ok(!id.includes(token));
  });
});

describe('extractBearerToken', () => {
  it('throws UNAUTHENTICATED when Authorization is missing', () => {
    assert.throws(
      () => extractBearerToken(null),
      (err: unknown) => err instanceof AuthError && err.code === PostKitErrorCode.UNAUTHENTICATED,
    );
  });

  it('throws UNAUTHENTICATED for non-Bearer scheme', () => {
    assert.throws(
      () => extractBearerToken('Basic abc'),
      (err: unknown) => err instanceof AuthError && err.code === PostKitErrorCode.UNAUTHENTICATED,
    );
  });

  it('accepts case-insensitive Bearer with extra spaces', () => {
    assert.equal(extractBearerToken('bearer  tk_live_abc123'), 'tk_live_abc123');
  });
});

describe('principalFromTenantKeyMap', () => {
  it('builds a Principal with default PoC scopes for legacy map entries', () => {
    const principal = principalFromTenantKeyMap('tk_live_abc123', KEY_MAP);
    assert.equal(principal.tenantId, 'inkads');
    assert.equal(principal.environment, 'production');
    assert.equal(principal.authType, 'api-key');
    assert.deepEqual([...principal.scopes], [...DEFAULT_POC_SCOPES]);
    assert.equal(principal.id, principalIdFromApiKey('tk_live_abc123'));
  });

  it('throws UNAUTHORIZED for unknown tokens without echoing the token', () => {
    try {
      principalFromTenantKeyMap('tk_unknown', KEY_MAP);
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
      assert.ok(!err.message.includes('tk_unknown'));
    }
  });

  it('rejects prototype-chain names as tokens', () => {
    assert.throws(
      () => principalFromTenantKeyMap('toString', KEY_MAP),
      (err: unknown) => err instanceof AuthError && err.code === PostKitErrorCode.UNAUTHORIZED,
    );
  });
});

describe('ApiKeyAuthenticator', () => {
  const auth = new ApiKeyAuthenticator(KEY_MAP);

  it('authenticates a valid Bearer credential to a Principal', async () => {
    const principal = await auth.authenticate(
      makeRequest({ authorization: 'Bearer tk_dev_xyz789' }),
    );
    assert.equal(principal.tenantId, 'inkads');
    assert.equal(principal.environment, 'development');
    assert.deepEqual([...principal.scopes], [...DEFAULT_POC_SCOPES]);
  });

  it('rejects missing credentials', async () => {
    await assert.rejects(
      () => auth.authenticate(makeRequest({})),
      (err: unknown) => err instanceof AuthError && err.code === PostKitErrorCode.UNAUTHENTICATED,
    );
  });

  it('rejects unknown credentials', async () => {
    await assert.rejects(
      () => auth.authenticate(makeRequest({ authorization: 'Bearer wrong' })),
      (err: unknown) => err instanceof AuthError && err.code === PostKitErrorCode.UNAUTHORIZED,
    );
  });
});

describe('requireScope', () => {
  const base: Principal = {
    id: 'ak_test',
    tenantId: 'acme',
    environment: 'development',
    authType: 'api-key',
    scopes: ['templates:read'],
  };

  it('allows when the principal holds the scope', () => {
    assert.doesNotThrow(() => requireScope(base, 'templates:read'));
  });

  it('throws UNAUTHORIZED when the scope is missing (non-sensitive message)', () => {
    try {
      requireScope(base, 'email:send');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
      assert.equal(err.message, 'The credential does not have the required permission.');
      assert.ok(!err.message.includes('ak_test'));
    }
  });
});

describe('tenantContextFromPrincipal', () => {
  it('exposes tenantId and environment from the principal', () => {
    const principal: Principal = {
      id: 'ak_x',
      tenantId: 'acme',
      environment: 'staging',
      authType: 'api-key',
      scopes: DEFAULT_POC_SCOPES,
    };
    assert.deepEqual(tenantContextFromPrincipal(principal), {
      tenantId: 'acme',
      environment: 'staging',
    });
  });
});

describe('MCP_TOOL_SCOPES', () => {
  it('maps every MCP tool to a semantic scope', () => {
    assert.equal(scopeForMcpTool('postkit.list_templates'), 'templates:read');
    assert.equal(scopeForMcpTool('postkit.get_template'), 'templates:read');
    assert.equal(scopeForMcpTool('postkit.get_template_schema'), 'templates:read');
    assert.equal(scopeForMcpTool('postkit.validate_template'), 'templates:validate');
    assert.equal(scopeForMcpTool('postkit.preview_template'), 'templates:preview');
    assert.equal(Object.keys(MCP_TOOL_SCOPES).length, 5);
  });
});
