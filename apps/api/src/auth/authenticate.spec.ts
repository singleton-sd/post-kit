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
import {
  apiKeyHashesEqual,
  hashApiKey,
  parseTenantKeyRegistry,
  type ParsedTenantKeyRegistry,
} from './tenant-key-registry';

const KEY_MAP = {
  tk_live_abc123: { tenantId: 'inkads', environment: 'production' as const },
  tk_dev_xyz789: { tenantId: 'inkads', environment: 'development' as const },
};

const FIXTURE_TOKEN = 'tk_dev_test_fixture_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FIXTURE_HASH = hashApiKey(FIXTURE_TOKEN);
const FIXTURE_ID = principalIdFromApiKey(FIXTURE_TOKEN);

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

function hashedRegistry(
  overrides: Partial<ParsedTenantKeyRegistry['keys'][string]> = {},
  legacyPlaintext: ParsedTenantKeyRegistry['legacyPlaintext'] = {},
): ParsedTenantKeyRegistry {
  return {
    keys: {
      [FIXTURE_ID]: {
        keyHash: FIXTURE_HASH,
        tenantId: 'acme',
        environment: 'development',
        scopes: [...DEFAULT_POC_SCOPES],
        revokedAt: null,
        expiresAt: null,
        ...overrides,
      },
    },
    legacyPlaintext,
  };
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

describe('hashApiKey / apiKeyHashesEqual', () => {
  it('hashes utf8 tokens to 64-char hex', () => {
    assert.match(hashApiKey(FIXTURE_TOKEN), /^[a-f0-9]{64}$/);
    assert.equal(hashApiKey(FIXTURE_TOKEN), FIXTURE_HASH);
  });

  it('compares digests without leaking raw tokens', () => {
    assert.equal(apiKeyHashesEqual(FIXTURE_HASH, FIXTURE_HASH), true);
    assert.equal(apiKeyHashesEqual(FIXTURE_HASH, hashApiKey('tk_dev_other')), false);
  });
});

describe('parseTenantKeyRegistry', () => {
  it('returns empty registry for blank input', () => {
    assert.deepEqual(parseTenantKeyRegistry(''), { keys: {}, legacyPlaintext: {} });
    assert.deepEqual(parseTenantKeyRegistry(undefined), { keys: {}, legacyPlaintext: {} });
  });

  it('parses a pure legacy plaintext map into legacyPlaintext', () => {
    const registry = parseTenantKeyRegistry(
      JSON.stringify({
        tk_dev_test_legacy: { tenantId: 'acme', environment: 'development' },
      }),
    );
    assert.deepEqual(registry.keys, {});
    assert.equal(registry.legacyPlaintext['tk_dev_test_legacy']?.tenantId, 'acme');
  });

  it('parses schema v2 hashed keys and optional legacyPlaintext', () => {
    const registry = parseTenantKeyRegistry(
      JSON.stringify({
        schemaVersion: 2,
        keys: {
          [FIXTURE_ID]: {
            keyHash: FIXTURE_HASH,
            tenantId: 'acme',
            environment: 'development',
            scopes: ['templates:read', 'email:send'],
            revokedAt: null,
            expiresAt: null,
          },
        },
        legacyPlaintext: {
          tk_dev_test_legacy: { tenantId: 'acme', environment: 'staging' },
        },
      }),
    );
    assert.equal(registry.keys[FIXTURE_ID]?.tenantId, 'acme');
    assert.deepEqual([...registry.keys[FIXTURE_ID]!.scopes], ['templates:read', 'email:send']);
    assert.equal(registry.legacyPlaintext['tk_dev_test_legacy']?.environment, 'staging');
  });

  it('rejects invalid JSON shapes as empty registry', () => {
    assert.deepEqual(parseTenantKeyRegistry('{'), { keys: {}, legacyPlaintext: {} });
    assert.deepEqual(parseTenantKeyRegistry('[]'), { keys: {}, legacyPlaintext: {} });
    assert.deepEqual(
      parseTenantKeyRegistry(
        JSON.stringify({ schemaVersion: 2, keys: { bad: { tenantId: 'x' } } }),
      ),
      { keys: {}, legacyPlaintext: {} },
    );
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

  it('authenticates a valid Bearer credential to a Principal (legacy map)', async () => {
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

  it('rejects unknown credentials without echoing the token', async () => {
    try {
      await auth.authenticate(makeRequest({ authorization: 'Bearer tk_dev_unknown_secret' }));
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
      assert.ok(!err.message.includes('tk_dev_unknown_secret'));
      assert.ok(!String(err).includes('tk_dev_unknown_secret'));
    }
  });

  it('authenticates a valid hashed key record', async () => {
    const hashedAuth = new ApiKeyAuthenticator(hashedRegistry());
    const principal = await hashedAuth.authenticate(
      makeRequest({ authorization: `Bearer ${FIXTURE_TOKEN}` }),
    );
    assert.equal(principal.id, FIXTURE_ID);
    assert.equal(principal.tenantId, 'acme');
    assert.equal(principal.environment, 'development');
    assert.deepEqual([...principal.scopes], [...DEFAULT_POC_SCOPES]);
  });

  it('rejects revoked hashed keys with a stable non-sensitive error', async () => {
    const hashedAuth = new ApiKeyAuthenticator(
      hashedRegistry({ revokedAt: '2026-01-01T00:00:00.000Z' }),
    );
    try {
      await hashedAuth.authenticate(makeRequest({ authorization: `Bearer ${FIXTURE_TOKEN}` }));
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
      assert.equal(err.message, 'The provided credential is no longer valid.');
      assert.ok(!err.message.includes(FIXTURE_TOKEN));
      assert.ok(!err.message.includes(FIXTURE_HASH));
    }
  });

  it('rejects expired hashed keys with a stable non-sensitive error', async () => {
    const hashedAuth = new ApiKeyAuthenticator(
      hashedRegistry({ expiresAt: '2020-01-01T00:00:00.000Z' }),
    );
    try {
      await hashedAuth.authenticate(makeRequest({ authorization: `Bearer ${FIXTURE_TOKEN}` }));
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
      assert.equal(err.message, 'The provided credential is no longer valid.');
      assert.ok(!err.message.includes(FIXTURE_TOKEN));
    }
  });

  it('rejects hashed keys with unparsable expiresAt (fail closed)', async () => {
    const hashedAuth = new ApiKeyAuthenticator(hashedRegistry({ expiresAt: 'not-a-date' }));
    await assert.rejects(
      () => hashedAuth.authenticate(makeRequest({ authorization: `Bearer ${FIXTURE_TOKEN}` })),
      (err: unknown) =>
        err instanceof AuthError &&
        err.code === PostKitErrorCode.UNAUTHORIZED &&
        err.message === 'The provided credential is no longer valid.',
    );
  });

  it('parseTenantKeyRegistry rejects empty or invalid key timestamps', () => {
    const base = {
      schemaVersion: 2,
      keys: {
        [FIXTURE_ID]: {
          keyHash: FIXTURE_HASH,
          tenantId: 'acme',
          environment: 'development',
          scopes: [...DEFAULT_POC_SCOPES],
          revokedAt: null,
          expiresAt: '',
        },
      },
    };
    assert.deepEqual(parseTenantKeyRegistry(JSON.stringify(base)), {
      keys: {},
      legacyPlaintext: {},
    });
    base.keys[FIXTURE_ID]!.expiresAt = 'tomorrow';
    assert.deepEqual(parseTenantKeyRegistry(JSON.stringify(base)), {
      keys: {},
      legacyPlaintext: {},
    });
  });

  it('dual-reads legacy plaintext while hashed keys are present', async () => {
    const hashedAuth = new ApiKeyAuthenticator(
      hashedRegistry({}, { tk_dev_test_legacy: { tenantId: 'acme', environment: 'staging' } }),
    );
    const principal = await hashedAuth.authenticate(
      makeRequest({ authorization: 'Bearer tk_dev_test_legacy' }),
    );
    assert.equal(principal.tenantId, 'acme');
    assert.equal(principal.environment, 'staging');
    assert.deepEqual([...principal.scopes], [...DEFAULT_POC_SCOPES]);
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
