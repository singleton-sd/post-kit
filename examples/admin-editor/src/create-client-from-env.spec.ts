import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPostKitClientFromEnv } from './create-client-from-env';

describe('createPostKitClientFromEnv', () => {
  it('throws when env is incomplete', () => {
    assert.throws(() => createPostKitClientFromEnv({}), /POSTKIT_API_BASE_URL/);
    assert.throws(
      () => createPostKitClientFromEnv({ POSTKIT_API_BASE_URL: 'https://example' }),
      /POSTKIT_API_KEY/,
    );
  });

  it('builds a client when both vars are set', () => {
    const client = createPostKitClientFromEnv({
      POSTKIT_API_BASE_URL: 'https://postkit.example/',
      POSTKIT_API_KEY: 'key-for-tests-only',
    });
    assert.ok(client);
  });
});
