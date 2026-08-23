import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import {
  ApiKeyTenantResolver,
  TenantResolverError,
  type TenantKeyMap,
} from './api-key-tenant-resolver';

/**
 * Minimal HttpRequest stub — only `headers.get` is required by the resolver.
 */
function makeRequest(headers: Record<string, string | undefined>): {
  headers: { get(name: string): string | null };
} {
  return {
    headers: {
      get(name: string): string | null {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

const keyMap: TenantKeyMap = {
  tk_live_abc123: { tenantId: 'inkads', environment: 'production' },
  tk_dev_xyz789: { tenantId: 'inkads', environment: 'development' },
  tk_stg_client2: { tenantId: 'acme', environment: 'staging' },
};

const resolver = new ApiKeyTenantResolver(keyMap);

describe('ApiKeyTenantResolver', () => {
  describe('valid credentials', () => {
    it('resolves the correct TenantContext for a known production key', async () => {
      const request = makeRequest({ authorization: 'Bearer tk_live_abc123' });
      const ctx = await resolver.resolve(request as never);
      assert.deepEqual(ctx, { tenantId: 'inkads', environment: 'production' });
    });

    it('resolves the correct TenantContext for a known development key', async () => {
      const request = makeRequest({ authorization: 'Bearer tk_dev_xyz789' });
      const ctx = await resolver.resolve(request as never);
      assert.deepEqual(ctx, { tenantId: 'inkads', environment: 'development' });
    });

    it('supports multiple keys mapping to the same tenantId with different environments', async () => {
      // Both tk_live_abc123 and tk_dev_xyz789 map to inkads
      const req1 = makeRequest({ authorization: 'Bearer tk_live_abc123' });
      const req2 = makeRequest({ authorization: 'Bearer tk_dev_xyz789' });
      const ctx1 = await resolver.resolve(req1 as never);
      const ctx2 = await resolver.resolve(req2 as never);
      assert.equal(ctx1.tenantId, ctx2.tenantId);
      assert.notEqual(ctx1.environment, ctx2.environment);
    });

    it('resolves a different tenant (acme staging)', async () => {
      const request = makeRequest({ authorization: 'Bearer tk_stg_client2' });
      const ctx = await resolver.resolve(request as never);
      assert.deepEqual(ctx, { tenantId: 'acme', environment: 'staging' });
    });
  });

  describe('missing Authorization header', () => {
    it('throws TenantResolverError with UNAUTHENTICATED when header is absent', async () => {
      const request = makeRequest({});
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHENTICATED);
          assert.equal(err.name, 'TenantResolverError');
          return true;
        },
      );
    });
  });

  describe('malformed Authorization header', () => {
    it('throws UNAUTHENTICATED when Authorization does not start with "Bearer "', async () => {
      const request = makeRequest({ authorization: 'Basic dXNlcjpwYXNz' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHENTICATED);
          return true;
        },
      );
    });

    it('throws UNAUTHENTICATED when Authorization is "Bearer" without a space and token', async () => {
      const request = makeRequest({ authorization: 'Bearer' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHENTICATED);
          return true;
        },
      );
    });

    it('throws UNAUTHENTICATED when "Bearer " prefix is present but token is empty', async () => {
      const request = makeRequest({ authorization: 'Bearer ' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHENTICATED);
          return true;
        },
      );
    });

    // RFC 7235 regression: auth-scheme token is case-insensitive
    it('accepts lowercase "bearer " scheme and resolves the correct TenantContext', async () => {
      const request = makeRequest({ authorization: 'bearer tk_live_abc123' });
      const ctx = await resolver.resolve(request as never);
      assert.deepEqual(ctx, { tenantId: 'inkads', environment: 'production' });
    });
  });

  describe('unknown token', () => {
    it('throws TenantResolverError with UNAUTHORIZED for a token not in the key map', async () => {
      const request = makeRequest({ authorization: 'Bearer tk_unknown_token' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
          assert.equal(err.name, 'TenantResolverError');
          // Error message must NOT contain the raw token value
          assert.ok(
            !err.message.includes('tk_unknown_token'),
            'Error message must not leak the raw token value',
          );
          return true;
        },
      );
    });

    // Prototype-chain regression: inherited property names must not resolve a tenant
    it('throws UNAUTHORIZED for a prototype-chain property name like "toString"', async () => {
      const request = makeRequest({ authorization: 'Bearer toString' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
          return true;
        },
      );
    });

    it('throws UNAUTHORIZED for the "__proto__" token', async () => {
      const request = makeRequest({ authorization: 'Bearer __proto__' });
      await assert.rejects(
        () => resolver.resolve(request as never),
        (err: unknown) => {
          assert.ok(err instanceof TenantResolverError);
          assert.equal(err.code, PostKitErrorCode.UNAUTHORIZED);
          return true;
        },
      );
    });
  });
});
