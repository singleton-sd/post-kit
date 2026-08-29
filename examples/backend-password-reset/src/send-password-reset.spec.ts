import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { PostKitErrorCode, type SendResponse } from '@singleton-sd/post-kit-types';
import { PASSWORD_RESET_TEMPLATE, sendPasswordReset } from './send-password-reset';

const INPUT = {
  email: 'jane@example.com',
  resetUrl: 'https://app.example.com/reset?token=placeholder',
  name: 'Jane Doe',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Every test injects `fetch`, so no test ever opens a socket. */
function clientWith(fetchImpl: typeof fetch, timeout?: number): PostKitClient {
  return new PostKitClient({
    endpoint: 'https://postkit.example.com',
    apiKey: 'test-api-key',
    ...(timeout === undefined ? {} : { timeout }),
    fetch: fetchImpl,
  });
}

describe('sendPasswordReset', () => {
  it('posts the template key and string variables and returns the send id', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const client = clientWith(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      const body: SendResponse = { id: 'corr-1', status: 'sent' };
      return jsonResponse(200, body);
    });

    const result = await sendPasswordReset(client, INPUT);

    assert.deepEqual(result, { outcome: 'sent', id: 'corr-1' });
    assert.equal(capturedUrl, 'https://postkit.example.com/emails/send');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['Authorization'],
      'Bearer test-api-key',
    );
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      template: PASSWORD_RESET_TEMPLATE,
      to: INPUT.email,
      variables: { name: INPUT.name, resetUrl: INPUT.resetUrl },
    });
  });

  it('maps a 404 TEMPLATE_NOT_FOUND response to a permanent failure', async () => {
    const client = clientWith(async () =>
      jsonResponse(404, {
        error: 'Template not found',
        code: PostKitErrorCode.TEMPLATE_NOT_FOUND,
        correlationId: 'corr-404',
      }),
    );

    const result = await sendPasswordReset(client, INPUT);

    assert.deepEqual(result, {
      outcome: 'permanent',
      code: PostKitErrorCode.TEMPLATE_NOT_FOUND,
      status: 404,
      correlationId: 'corr-404',
    });
  });

  it('maps a 503 PROVIDER_FAILURE response to a retryable failure', async () => {
    const client = clientWith(async () =>
      jsonResponse(503, {
        error: 'Email provider failed to send the message.',
        code: PostKitErrorCode.PROVIDER_FAILURE,
        correlationId: 'corr-503',
      }),
    );

    const result = await sendPasswordReset(client, INPUT);

    assert.deepEqual(result, {
      outcome: 'retryable',
      code: PostKitErrorCode.PROVIDER_FAILURE,
      status: 503,
      correlationId: 'corr-503',
    });
  });

  it('maps a client timeout to a retryable failure', async () => {
    const client = clientWith(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('expected an AbortSignal'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        }),
      20,
    );

    const result = await sendPasswordReset(client, INPUT);

    assert.deepEqual(result, {
      outcome: 'retryable',
      code: 'TIMEOUT',
      status: undefined,
      correlationId: undefined,
    });
  });
});
