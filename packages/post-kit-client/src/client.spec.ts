import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PostKitErrorCode,
  type SendRequest,
  type SendResponse,
} from '@singleton-sd/post-kit-types';
import { PostKitClient } from './client';
import { PostKitRequestError } from './errors';

const SEND_REQUEST: SendRequest = {
  template: 'marketing.contact-us',
  to: 'hello@example.com',
  variables: { name: 'Jane', email: 'jane@example.com', message: 'Hi' },
};

const SEND_RESPONSE: SendResponse = {
  id: 'corr-success-1',
  status: 'sent',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PostKitClient', () => {
  it('POSTs SendRequest to {endpoint}/emails/send with Bearer auth and returns SendResponse', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const fetchMock: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse(200, SEND_RESPONSE);
    };

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: fetchMock,
    });

    const result = await client.send(SEND_REQUEST);

    assert.equal(capturedUrl, 'https://postkit.example.com/emails/send');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['Authorization'],
      'Bearer pk_test_key',
    );
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['Content-Type'],
      'application/json',
    );
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), SEND_REQUEST);
    assert.deepEqual(result, SEND_RESPONSE);
  });

  it('strips a trailing slash from the endpoint base URL', async () => {
    let capturedUrl = '';
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com/',
      apiKey: 'pk_test_key',
      fetch: async (input) => {
        capturedUrl = String(input);
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    await client.send(SEND_REQUEST);
    assert.equal(capturedUrl, 'https://postkit.example.com/emails/send');
  });

  it('throws PostKitRequestError with status, code, and correlationId on non-2xx', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async () =>
        jsonResponse(404, {
          error: 'Template not found',
          code: PostKitErrorCode.TEMPLATE_NOT_FOUND,
          correlationId: 'corr-err-1',
        }),
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.status, 404);
        assert.equal(err.code, PostKitErrorCode.TEMPLATE_NOT_FOUND);
        assert.equal(err.correlationId, 'corr-err-1');
        assert.match(err.message, /Template not found/);
        return true;
      },
    );
  });

  it('throws TIMEOUT when the request exceeds the client timeout', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      timeout: 20,
      fetch: async (_input, init) => {
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('expected AbortSignal'));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        });
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.code, 'TIMEOUT');
        assert.equal(err.status, undefined);
        return true;
      },
    );
  });

  it('throws TIMEOUT when fetch rejects with native TimeoutError', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.code, 'TIMEOUT');
        return true;
      },
    );
  });

  it('throws TIMEOUT when response body read aborts after headers arrive', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      timeout: 20,
      fetch: async (_input, init) =>
        ({
          ok: true,
          json: async () => {
            await new Promise<void>((_resolve, reject) => {
              const signal = init?.signal;
              if (!signal) {
                reject(new Error('expected AbortSignal'));
                return;
              }
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('The operation was aborted.', 'AbortError')),
                { once: true },
              );
            });
            return SEND_RESPONSE;
          },
        }) as Response,
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.code, 'TIMEOUT');
        return true;
      },
    );
  });

  it('threads a custom AbortSignal through to fetch', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      timeout: 0,
      fetch: async (_input, init) => {
        seenSignal = init?.signal ?? undefined;
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    await client.send(SEND_REQUEST, { signal: controller.signal });
    assert.ok(seenSignal);
    assert.equal(seenSignal.aborted, false);
    controller.abort();
    assert.equal(seenSignal.aborted, true);
  });

  it('throws NETWORK_ERROR when fetch fails with a non-abort error', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.code, 'NETWORK_ERROR');
        assert.equal(err.status, undefined);
        assert.match(err.message, /fetch failed/);
        return true;
      },
    );
  });

  it('sends x-correlation-id when correlationId is supplied on send()', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async (_input, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return jsonResponse(200, { id: 'my-trace-01', status: 'sent' });
      },
    });

    const result = await client.send(SEND_REQUEST, { correlationId: 'my-trace-01' });

    assert.equal(capturedHeaders?.['x-correlation-id'], 'my-trace-01');
    assert.equal(result.id, 'my-trace-01');
    assert.equal(result.status, 'sent');
  });

  it('does not send x-correlation-id when correlationId is omitted', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async (_input, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    await client.send(SEND_REQUEST);

    assert.equal(capturedHeaders?.['x-correlation-id'], undefined);
  });

  it('uses a client-level default correlationId when send() does not override it', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      correlationId: 'client-default',
      fetch: async (_input, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return jsonResponse(200, { id: 'client-default', status: 'sent' });
      },
    });

    await client.send(SEND_REQUEST);

    assert.equal(capturedHeaders?.['x-correlation-id'], 'client-default');
  });

  it('prefers per-request correlationId over the client default', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      correlationId: 'client-default',
      fetch: async (_input, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return jsonResponse(200, { id: 'request-trace', status: 'sent' });
      },
    });

    await client.send(SEND_REQUEST, { correlationId: 'request-trace' });

    assert.equal(capturedHeaders?.['x-correlation-id'], 'request-trace');
  });

  it('rejects invalid correlationId values before the request is sent', async () => {
    let fetchCalled = false;
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async () => {
        fetchCalled = true;
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    const invalidValues = [
      '',
      'short',
      'a'.repeat(129),
      'has spaces',
      'has/slash',
      'has:newline\n',
    ];

    for (const correlationId of invalidValues) {
      fetchCalled = false;
      await assert.rejects(
        () => client.send(SEND_REQUEST, { correlationId }),
        (err: unknown) => {
          assert.ok(err instanceof PostKitRequestError);
          assert.equal(err.code, 'INVALID_CORRELATION_ID');
          assert.equal(err.status, undefined);
          assert.equal(err.correlationId, undefined);
          return true;
        },
      );
      assert.equal(fetchCalled, false, `fetch must not run for ${JSON.stringify(correlationId)}`);
    }
  });

  it('surfaces correlationId from the X-Correlation-Id header when the error body omits it', async () => {
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      fetch: async () =>
        new Response(
          JSON.stringify({ error: 'Bad gateway', code: PostKitErrorCode.PROVIDER_FAILURE }),
          {
            status: 502,
            headers: {
              'Content-Type': 'application/json',
              'X-Correlation-Id': 'header-corr-1',
            },
          },
        ),
    });

    await assert.rejects(
      () => client.send(SEND_REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof PostKitRequestError);
        assert.equal(err.correlationId, 'header-corr-1');
        return true;
      },
    );
  });

  it('rethrows when the caller AbortSignal aborts the request', async () => {
    const controller = new AbortController();
    const client = new PostKitClient({
      endpoint: 'https://postkit.example.com',
      apiKey: 'pk_test_key',
      timeout: 30_000,
      fetch: async (_input, init) => {
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('expected AbortSignal'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        });
        return jsonResponse(200, SEND_RESPONSE);
      },
    });

    const pending = client.send(SEND_REQUEST, { signal: controller.signal });
    controller.abort();

    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof DOMException || (err instanceof Error && err.name === 'AbortError'));
      assert.notEqual(err instanceof PostKitRequestError && err.code === 'TIMEOUT', true);
      return true;
    });
  });
});
