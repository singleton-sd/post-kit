import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPostKitClientFromEnv, isSendTestEnvConfigured } from './create-client-from-env';

describe('createPostKitClientFromEnv', () => {
  it('reports incomplete env as not configured', () => {
    assert.equal(isSendTestEnvConfigured({}), false);
    assert.equal(isSendTestEnvConfigured({ POSTKIT_API_BASE_URL: 'https://example' }), false);
  });

  it('throws when env is incomplete', () => {
    assert.throws(() => createPostKitClientFromEnv({}), /POSTKIT_API_BASE_URL/);
    assert.throws(
      () => createPostKitClientFromEnv({ POSTKIT_API_BASE_URL: 'https://example' }),
      /POSTKIT_API_KEY/,
    );
  });

  it('builds a client when both vars are set', () => {
    const env = {
      POSTKIT_API_BASE_URL: 'https://postkit.example/',
      POSTKIT_API_KEY: 'key-for-tests-only',
    };
    assert.equal(isSendTestEnvConfigured(env), true);
    const client = createPostKitClientFromEnv(env);
    assert.ok(client);
  });
});
