import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import {
  createLogger,
  hashRecipient,
  recipientHashKeyVersionId,
  RECIPIENT_HASH_HMAC_KEY_ENV,
  RECIPIENT_HASH_HMAC_KEY_VERSION_ENV,
} from './logger';

describe('createLogger', () => {
  it('info() emits JSON containing msg and correlationId', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-1', (line) => lines.push(line));

    logger.info('test.event');

    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.msg, 'test.event');
    assert.equal(entry.correlationId, 'corr-1');
    assert.equal(entry.level, 'info');
  });

  it('error() includes errorCode in output', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-2', (line) => lines.push(line));

    logger.error('contact.request.failed', {
      outcome: 'failed',
      errorCode: PostKitErrorCode.PROVIDER_FAILURE,
    });

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.level, 'error');
    assert.equal(entry.errorCode, PostKitErrorCode.PROVIDER_FAILURE);
    assert.equal(entry.outcome, 'failed');
    assert.equal(entry.correlationId, 'corr-2');
  });

  it('injected write function receives each log line', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-3', (line) => lines.push(line));

    logger.info('first');
    logger.info('second');
    logger.error('third');

    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]!).msg, 'first');
    assert.equal(JSON.parse(lines[1]!).msg, 'second');
    assert.equal(JSON.parse(lines[2]!).msg, 'third');
  });

  it('partial fields are included in the output', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-4', (line) => lines.push(line));

    logger.info('contact.request.completed', { outcome: 'sent', durationMs: 42 });

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.outcome, 'sent');
    assert.equal(entry.durationMs, 42);
  });

  it('missing (undefined) fields are omitted from the JSON output', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-5', (line) => lines.push(line));

    logger.info('contact.request.received', { tenantId: undefined, outcome: 'sent' });

    const entry = JSON.parse(lines[0]!);
    assert.ok(!('tenantId' in entry), 'tenantId should be omitted when undefined');
    assert.equal(entry.outcome, 'sent');
  });

  it('omits unsupported extra properties from the serialized entry', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-extra', (line) => lines.push(line));

    logger.info('event', {
      outcome: 'sent',
      recipientEmail: 'user@example.com',
      templateVariables: { name: 'Ada' },
    } as Parameters<typeof logger.info>[1]);

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.outcome, 'sent');
    assert.ok(!('recipientEmail' in entry));
    assert.ok(!('templateVariables' in entry));
  });

  it('correlationId in fields is not duplicated / overwritten', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-6', (line) => lines.push(line));

    // Even if caller passes correlationId in fields, the logger's own id wins
    logger.info('event', { correlationId: 'different' });

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.correlationId, 'corr-6');
  });

  it('falls back to console.log when no write function supplied (smoke test)', () => {
    // Just verify no exception is thrown when using the default writer
    const logger = createLogger('corr-default');
    assert.doesNotThrow(() => logger.info('smoke'));
    assert.doesNotThrow(() => logger.error('smoke'));
  });

  it('includes failureCategory, failureClass, and recipientHash in the contract', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-fc', (line) => lines.push(line));

    logger.error('send.request.failed', {
      outcome: 'failed',
      failureCategory: 'permanent',
      failureClass: 'permanent',
      attempt: 1,
      recipientHash: `${'a'.repeat(8)}.${'b'.repeat(16)}`,
      durationMs: 10,
    });

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.failureCategory, 'permanent');
    assert.equal(entry.failureClass, 'permanent');
    assert.equal(entry.attempt, 1);
    assert.equal(entry.recipientHash, `${'a'.repeat(8)}.${'b'.repeat(16)}`);
  });

  it('omits recipientHash values that are not versioned HMAC digests', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-rh', (line) => lines.push(line));

    logger.error('send.request.failed', {
      outcome: 'failed',
      recipientHash: 'user@example.com',
    });

    const entry = JSON.parse(lines[0]!);
    assert.ok(!('recipientHash' in entry));
  });

  it('omits legacy bare 16-char hex recipientHash from new emissions', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-legacy', (line) => lines.push(line));

    logger.error('send.request.failed', {
      outcome: 'failed',
      recipientHash: 'a'.repeat(16),
    });

    const entry = JSON.parse(lines[0]!);
    assert.ok(!('recipientHash' in entry));
  });

  it('includes providerRequestId in the contract', () => {
    const lines: string[] = [];
    const logger = createLogger('corr-pr', (line) => lines.push(line));

    logger.error('send.request.failed', {
      outcome: 'failed',
      providerRequestId: 'req-99',
    });

    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.providerRequestId, 'req-99');
  });
});

describe('hashRecipient', () => {
  it('returns a versioned HMAC digest for the normalized address (injectable secret)', () => {
    const secret = 'unit-test-hmac-secret';
    const keyVersion = 'aaaaaaaa111111112222222233333333';
    const digest = createHmac('sha256', secret)
      .update('user@example.com', 'utf8')
      .digest('hex')
      .slice(0, 16);
    const expected = `aaaaaaaa.${digest}`;

    assert.equal(hashRecipient('user@example.com', { secret, keyVersion }), expected);
    assert.equal(hashRecipient('  User@Example.COM  ', { secret, keyVersion }), expected);
  });

  it('reads secret and version from environment when options omit them', () => {
    const priorKey = process.env[RECIPIENT_HASH_HMAC_KEY_ENV];
    const priorVersion = process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV];
    process.env[RECIPIENT_HASH_HMAC_KEY_ENV] = 'env-hmac-secret';
    process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV] = 'bbbbbbbb999999998888888877777777';
    try {
      const digest = createHmac('sha256', 'env-hmac-secret')
        .update('ops@example.com', 'utf8')
        .digest('hex')
        .slice(0, 16);

      assert.equal(hashRecipient('ops@example.com'), `bbbbbbbb.${digest}`);
    } finally {
      if (priorKey === undefined) delete process.env[RECIPIENT_HASH_HMAC_KEY_ENV];
      else process.env[RECIPIENT_HASH_HMAC_KEY_ENV] = priorKey;
      if (priorVersion === undefined) delete process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV];
      else process.env[RECIPIENT_HASH_HMAC_KEY_VERSION_ENV] = priorVersion;
    }
  });

  it('changes digest when the HMAC key changes (rotation)', () => {
    const email = 'rotate@example.com';
    const first = hashRecipient(email, { secret: 'key-v1', keyVersion: '11111111aaaaaaaa' });
    const second = hashRecipient(email, { secret: 'key-v2', keyVersion: '22222222bbbbbbbb' });
    assert.notEqual(first, second);
    assert.equal(first.slice(0, 8), '11111111');
    assert.equal(second.slice(0, 8), '22222222');
  });

  it('does not return the raw email address', () => {
    const hash = hashRecipient('secret.user@acme.com', {
      secret: 'unit-test-hmac-secret',
      keyVersion: 'cccccccc000000001111111122222222',
    });
    assert.ok(!hash.includes('secret'));
    assert.ok(!hash.includes('@'));
    assert.match(hash, /^[a-f0-9]{8}\.[a-f0-9]{16}$/);
  });

  it('throws when the HMAC secret is empty', () => {
    assert.throws(
      () => hashRecipient('user@example.com', { secret: '' }),
      /RECIPIENT_HASH_HMAC_KEY/,
    );
  });

  it('derives a stable 8-hex keyVersionId for non-hex local versions', () => {
    assert.equal(recipientHashKeyVersionId('local').length, 8);
    assert.match(recipientHashKeyVersionId('local'), /^[a-f0-9]{8}$/);
    assert.equal(recipientHashKeyVersionId('local'), recipientHashKeyVersionId('local'));
  });
});
