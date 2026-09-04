import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateIdempotencyKey } from './idempotency-key';

describe('validateIdempotencyKey', () => {
  it('accepts allowlisted keys up to 128 characters', () => {
    assert.deepEqual(validateIdempotencyKey('retry-1'), { ok: true, key: 'retry-1' });
    assert.deepEqual(validateIdempotencyKey('a'.repeat(128)), {
      ok: true,
      key: 'a'.repeat(128),
    });
    assert.deepEqual(validateIdempotencyKey('uuid:v4_or.tilde~ok'), {
      ok: true,
      key: 'uuid:v4_or.tilde~ok',
    });
  });

  it('trims surrounding whitespace', () => {
    assert.deepEqual(validateIdempotencyKey('  key-1  '), { ok: true, key: 'key-1' });
  });

  it('rejects empty and whitespace-only values', () => {
    assert.equal(validateIdempotencyKey('').ok, false);
    assert.equal(validateIdempotencyKey('   ').ok, false);
  });

  it('rejects oversized keys before storage', () => {
    const result = validateIdempotencyKey('a'.repeat(129));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /128/);
  });

  it('rejects unsafe charset', () => {
    assert.equal(validateIdempotencyKey('has space').ok, false);
    assert.equal(validateIdempotencyKey('path/../x').ok, false);
    assert.equal(validateIdempotencyKey('null\0byte').ok, false);
  });
});
