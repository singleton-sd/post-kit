import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateCorrelationId, resolveCorrelationId } from './correlation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateCorrelationId', () => {
  it('returns a non-empty string matching UUID v4 pattern', () => {
    const id = generateCorrelationId();
    assert.ok(id.length > 0, 'should be non-empty');
    assert.match(id, UUID_V4);
  });

  it('returns a different value on each call', () => {
    assert.notEqual(generateCorrelationId(), generateCorrelationId());
  });
});

describe('resolveCorrelationId', () => {
  it('generates a fresh ID when headerValue is undefined', () => {
    const id = resolveCorrelationId(undefined);
    assert.ok(id.length > 0);
    assert.match(id, UUID_V4);
  });

  it('returns a valid header value as-is', () => {
    assert.equal(resolveCorrelationId('valid-id-123'), 'valid-id-123');
  });

  it('accepts UUIDs as valid header values', () => {
    const uuid = generateCorrelationId();
    assert.equal(resolveCorrelationId(uuid), uuid);
  });

  it('sanitises a value containing HTML/script injection characters', () => {
    const id = resolveCorrelationId('<script>alert(1)</script>');
    assert.notEqual(id, '<script>alert(1)</script>');
    assert.match(id, UUID_V4);
  });

  it('generates a fresh ID when headerValue exceeds 128 chars', () => {
    const id = resolveCorrelationId('a'.repeat(200));
    assert.match(id, UUID_V4);
  });

  it('generates a fresh ID when headerValue is an empty string', () => {
    const id = resolveCorrelationId('');
    assert.match(id, UUID_V4);
  });

  it('generates a fresh ID when headerValue is fewer than 8 chars', () => {
    const id = resolveCorrelationId('short');
    assert.match(id, UUID_V4);
  });

  it('accepts an ID at the minimum boundary (8 chars)', () => {
    assert.equal(resolveCorrelationId('abcd1234'), 'abcd1234');
  });

  it('accepts an ID at the maximum boundary (128 chars)', () => {
    const max = 'a'.repeat(128);
    assert.equal(resolveCorrelationId(max), max);
  });
});
