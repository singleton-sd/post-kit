import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendRequest,
} from '@singleton-sd/post-kit-email';
import {
  DEFAULT_FUNCTION_TIMEOUT_MS,
  DEFAULT_SEND_MAX_ATTEMPTS,
  DEFAULT_SEND_PROVIDER_TIMEOUT_MS,
  SendTimeoutError,
  classifySendFailure,
  computeRetryBudgetMs,
  deliverSend,
  resolveSendDeliveryPolicy,
  sendWithTimeout,
} from './send-delivery';

function providerThat(impl: EmailProvider['send']): EmailProvider {
  return {
    name: 'development',
    isConfigured: () => true,
    send: impl,
  };
}

const REQUEST: EmailSendRequest = {
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  correlationId: 'corr-1',
};

describe('classifySendFailure', () => {
  it('classifies SendTimeoutError as transient/timeout but not internally retryable', () => {
    const classified = classifySendFailure(new SendTimeoutError(1_000));
    assert.deepEqual(classified, {
      failureClass: 'transient',
      failureCategory: 'timeout',
      retryable: false,
    });
  });

  it('classifies provider transient and rate_limit as transient', () => {
    assert.equal(
      classifySendFailure(
        new EmailProviderError({
          message: '5xx',
          kind: 'transient',
          provider: 'development',
          statusCode: 503,
        }),
      ).failureClass,
      'transient',
    );
    assert.equal(
      classifySendFailure(
        new EmailProviderError({
          message: '429',
          kind: 'rate_limit',
          provider: 'development',
          statusCode: 429,
        }),
      ).failureClass,
      'transient',
    );
  });

  it('does not mark transport failures without HTTP status as internally retryable', () => {
    const classified = classifySendFailure(
      new EmailProviderError({
        message: 'transport failure',
        kind: 'transient',
        provider: 'development',
      }),
    );
    assert.equal(classified.failureClass, 'transient');
    assert.equal(classified.retryable, false);
  });

  it('retries only when the provider error is retryable and has an HTTP status', () => {
    assert.equal(
      classifySendFailure(
        new EmailProviderError({
          message: '5xx',
          kind: 'transient',
          provider: 'development',
          statusCode: 502,
          retryable: true,
        }),
      ).retryable,
      true,
    );
    assert.equal(
      classifySendFailure(
        new EmailProviderError({
          message: 'adapter timeout',
          kind: 'transient',
          provider: 'development',
          retryable: false,
        }),
      ).retryable,
      false,
    );
  });

  it('classifies permanent, validation, configuration, cancelled as permanent', () => {
    for (const kind of ['permanent', 'validation', 'configuration', 'cancelled'] as const) {
      const classified = classifySendFailure(
        new EmailProviderError({ message: kind, kind, provider: 'development' }),
      );
      assert.equal(classified.failureClass, 'permanent', kind);
      assert.equal(classified.retryable, false, kind);
    }
  });

  it('treats cancelled-with-timeout-cause as transient timeout (not internally retryable)', () => {
    const classified = classifySendFailure(
      new EmailProviderError({
        message: 'cancelled',
        kind: 'cancelled',
        provider: 'development',
        cause: new SendTimeoutError(500),
      }),
    );
    assert.equal(classified.failureClass, 'transient');
    assert.equal(classified.failureCategory, 'timeout');
    assert.equal(classified.retryable, false);
  });
});

describe('resolveSendDeliveryPolicy', () => {
  it('returns defaults inside the Function App limit', () => {
    const policy = resolveSendDeliveryPolicy({});
    assert.equal(policy.providerTimeoutMs, DEFAULT_SEND_PROVIDER_TIMEOUT_MS);
    assert.equal(policy.maxAttempts, DEFAULT_SEND_MAX_ATTEMPTS);
    assert.equal(policy.functionTimeoutMs, DEFAULT_FUNCTION_TIMEOUT_MS);
    assert.ok(policy.retryBudgetMs < policy.functionTimeoutMs);
    assert.ok(policy.providerTimeoutMs < policy.functionTimeoutMs);
  });

  it('clamps maxAttempts when the retry budget would exceed the function limit', () => {
    const policy = resolveSendDeliveryPolicy({
      FUNCTION_TIMEOUT_MS: '20000',
      SEND_PROVIDER_TIMEOUT_MS: '10000',
      SEND_MAX_ATTEMPTS: '5',
      SEND_RETRY_BASE_DELAY_MS: '100',
    });
    // 5 * 10s exceeds 20s - 60s headroom (available = max(10s, -40s) = 10s) → clamp to 1
    assert.equal(policy.maxAttempts, 1);
    assert.ok(
      computeRetryBudgetMs(policy.maxAttempts, policy.providerTimeoutMs, policy.retryBaseDelayMs) <=
        Math.max(policy.providerTimeoutMs, policy.functionTimeoutMs - 60_000) ||
        policy.maxAttempts === 1,
    );
  });

  it('honours explicit positive overrides', () => {
    const policy = resolveSendDeliveryPolicy({
      SEND_PROVIDER_TIMEOUT_MS: '8000',
      SEND_MAX_ATTEMPTS: '2',
      SEND_RETRY_BASE_DELAY_MS: '100',
      FUNCTION_TIMEOUT_MS: '300000',
    });
    assert.equal(policy.providerTimeoutMs, 8_000);
    assert.equal(policy.maxAttempts, 2);
    assert.equal(policy.retryBaseDelayMs, 100);
  });
});

describe('sendWithTimeout', () => {
  it('returns the provider result when it completes in time', async () => {
    const provider = providerThat(async () => ({
      providerMessageId: 'msg-1',
      accepted: true,
    }));
    const result = await sendWithTimeout(provider, REQUEST, 1_000);
    assert.equal(result.providerMessageId, 'msg-1');
  });

  it('throws SendTimeoutError when the provider hangs', async () => {
    const provider = providerThat(
      async (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(
              new EmailProviderError({
                message: 'cancelled',
                kind: 'cancelled',
                provider: 'development',
                cause: signal.reason,
              }),
            );
          });
        }),
    );

    await assert.rejects(
      () => sendWithTimeout(provider, REQUEST, 30),
      (error: unknown) => error instanceof SendTimeoutError && error.timeoutMs === 30,
    );
  });

  it('throws SendTimeoutError even when the provider ignores abort', async () => {
    const provider = providerThat(
      async () =>
        new Promise(() => {
          /* never settles, never observes abort */
        }),
    );

    await assert.rejects(
      () => sendWithTimeout(provider, REQUEST, 25),
      (error: unknown) => error instanceof SendTimeoutError && error.timeoutMs === 25,
    );
  });
});

describe('deliverSend', () => {
  it('does not retry without allowRetry even on transient failure', async () => {
    let calls = 0;
    const provider = providerThat(async () => {
      calls += 1;
      throw new EmailProviderError({
        message: '5xx',
        kind: 'transient',
        provider: 'development',
        statusCode: 503,
      });
    });
    const policy = resolveSendDeliveryPolicy({
      SEND_MAX_ATTEMPTS: '3',
      SEND_PROVIDER_TIMEOUT_MS: '1000',
    });

    const delivery = await deliverSend(provider, REQUEST, {
      policy,
      allowRetry: false,
      sleepFn: async () => undefined,
    });

    assert.equal(delivery.ok, false);
    assert.equal(calls, 1);
    if (!delivery.ok) {
      assert.equal(delivery.failureClass, 'transient');
      assert.equal(delivery.attempts, 1);
    }
  });

  it('retries transient failures then succeeds when allowRetry is true', async () => {
    let calls = 0;
    const provider = providerThat(async () => {
      calls += 1;
      if (calls < 3) {
        throw new EmailProviderError({
          message: '5xx',
          kind: 'transient',
          provider: 'development',
          statusCode: 503,
        });
      }
      return { providerMessageId: 'msg-ok', accepted: true };
    });
    const policy = resolveSendDeliveryPolicy({
      SEND_MAX_ATTEMPTS: '3',
      SEND_PROVIDER_TIMEOUT_MS: '1000',
      SEND_RETRY_BASE_DELAY_MS: '1',
    });
    const attempts: number[] = [];

    const delivery = await deliverSend(provider, REQUEST, {
      policy,
      allowRetry: true,
      sleepFn: async () => undefined,
      onAttempt: (info) => attempts.push(info.attempt),
    });

    assert.equal(delivery.ok, true);
    assert.equal(calls, 3);
    if (delivery.ok) {
      assert.equal(delivery.result.providerMessageId, 'msg-ok');
      assert.equal(delivery.attempts, 3);
    }
    assert.deepEqual(attempts, [1, 2, 3]);
  });

  it('does not retry permanent failures even when allowRetry is true', async () => {
    let calls = 0;
    const provider = providerThat(async () => {
      calls += 1;
      throw new EmailProviderError({
        message: 'bad recipient',
        kind: 'permanent',
        provider: 'development',
      });
    });
    const policy = resolveSendDeliveryPolicy({ SEND_MAX_ATTEMPTS: '3' });

    const delivery = await deliverSend(provider, REQUEST, {
      policy,
      allowRetry: true,
      sleepFn: async () => undefined,
    });

    assert.equal(delivery.ok, false);
    assert.equal(calls, 1);
    if (!delivery.ok) {
      assert.equal(delivery.failureClass, 'permanent');
      assert.equal(delivery.failureCategory, 'permanent');
    }
  });

  it('does not retry timeouts even when allowRetry is true', async () => {
    let calls = 0;
    const provider = providerThat(async (_req, signal) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(
            new EmailProviderError({
              message: 'cancelled',
              kind: 'cancelled',
              provider: 'development',
              cause: signal.reason,
            }),
          );
        });
      });
    });
    const policy = {
      ...resolveSendDeliveryPolicy({ SEND_MAX_ATTEMPTS: '3' }),
      providerTimeoutMs: 40,
    };

    const delivery = await deliverSend(provider, REQUEST, {
      policy,
      allowRetry: true,
      sleepFn: async () => undefined,
    });

    assert.equal(delivery.ok, false);
    assert.equal(calls, 1);
    if (!delivery.ok) {
      assert.equal(delivery.failureClass, 'transient');
      assert.equal(delivery.failureCategory, 'timeout');
      assert.equal(delivery.attempts, 1);
    }
  });
});
