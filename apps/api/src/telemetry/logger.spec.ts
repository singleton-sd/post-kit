import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import { createLogger } from './logger';

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
});
