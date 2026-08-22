import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DevelopmentEmailProvider } from './development-email.provider';
import { createEmailProvider, loadEmailRuntimeConfig } from './create-email-provider';
import { ForwardEmailProvider } from './forward-email.provider';
import { EmailProviderError, formatFromHeader } from './email-types';

describe('formatFromHeader', () => {
  it('includes display name without CR/LF', () => {
    assert.equal(
      formatFromHeader('noreply@example.com', 'Plattform Kit\r\nBcc: evil'),
      '"Plattform KitBcc: evil" <noreply@example.com>',
    );
  });
});

describe('loadEmailRuntimeConfig', () => {
  it('defaults preview/local to development even when a token exists', () => {
    const config = loadEmailRuntimeConfig({
      FORWARD_EMAIL_TOKEN: 'secret',
      NODE_ENV: 'development',
    });
    assert.equal(config.provider, 'development');
    assert.equal(config.forwardEmailTokenConfigured, true);
  });

  it('requires explicit production send opt-in', () => {
    const blocked = loadEmailRuntimeConfig({
      FORWARD_EMAIL_TOKEN: 'secret',
      NODE_ENV: 'production',
    });
    assert.equal(blocked.provider, 'development');

    const allowed = loadEmailRuntimeConfig({
      FORWARD_EMAIL_TOKEN: 'secret',
      NODE_ENV: 'production',
      EMAIL_ALLOW_PRODUCTION_SEND: 'true',
    });
    assert.equal(allowed.provider, 'forward-email');
  });

  it('requires production send opt-in even when EMAIL_PROVIDER=forward-email', () => {
    const blocked = loadEmailRuntimeConfig({
      EMAIL_PROVIDER: 'forward-email',
      FORWARD_EMAIL_TOKEN: 'secret',
    });
    assert.equal(blocked.provider, 'development');

    const allowed = loadEmailRuntimeConfig({
      EMAIL_PROVIDER: 'forward-email',
      FORWARD_EMAIL_TOKEN: 'secret',
      EMAIL_ALLOW_PRODUCTION_SEND: 'true',
    });
    assert.equal(allowed.provider, 'forward-email');
  });

  it('honours EMAIL_PROVIDER=forward-email when production send is allowed', () => {
    const config = loadEmailRuntimeConfig({
      EMAIL_PROVIDER: 'forward-email',
      EMAIL_ALLOW_PRODUCTION_SEND: 'true',
      EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      EMAIL_FROM_NAME: 'Plattform Kit',
      CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
    });
    assert.equal(config.provider, 'forward-email');
    assert.equal(config.fromAddress, 'noreply@mail.plattform-kit.poc.singletonsd.com');
    assert.equal(config.contactInboxAddress, 'hello@singletonsd.com');
  });
});

describe('ForwardEmailProvider', () => {
  it('reports unconfigured when FORWARD_EMAIL_TOKEN is missing', () => {
    const provider = new ForwardEmailProvider({ apiToken: '' });
    assert.equal(provider.isConfigured(), false);
  });

  it('fails clearly when send is attempted without a token', async () => {
    const provider = new ForwardEmailProvider({ apiToken: '' });
    await assert.rejects(
      () =>
        provider.send({
          to: 'hello@singletonsd.com',
          from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          subject: 'x',
          text: 'y',
        }),
      (error: unknown) => error instanceof EmailProviderError && error.kind === 'configuration',
    );
  });

  it('posts form-encoded mail with Basic auth and display name', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new ForwardEmailProvider({
      apiToken: 'test-token',
      baseUrl: 'https://api.example.test',
      maxRetries: 0,
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ id: 'fe-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-9' },
        });
      },
    });

    const result = await provider.send({
      to: 'hello@singletonsd.com',
      from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      fromName: 'Plattform Kit',
      replyTo: 'jane@acme.com',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
      correlationId: 'corr-1',
    });

    assert.equal(result.accepted, true);
    assert.equal(result.providerMessageId, 'fe-123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.example.test/v1/emails');
    const headers = new Headers(calls[0]?.init.headers);
    assert.equal(
      headers.get('Authorization'),
      `Basic ${Buffer.from('test-token:').toString('base64')}`,
    );
    assert.equal(headers.get('X-Correlation-Id'), 'corr-1');
    const body = String(calls[0]?.init.body);
    assert.match(body, /replyTo=jane%40acme.com/);
    assert.match(body, /to=hello%40singletonsd.com/);
    assert.match(body, /from=%22Plattform\+Kit%22/);
    assert.match(body, /html=%3Cp%3EBody%3C%2Fp%3E/);
  });

  it('rejects header injection in reply-to', async () => {
    const provider = new ForwardEmailProvider({
      apiToken: 'test-token',
      maxRetries: 0,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    await assert.rejects(
      () =>
        provider.send({
          to: 'hello@singletonsd.com',
          from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          replyTo: 'evil@x.com\nBcc: leak@x.com',
          subject: 'Hi',
          text: 'x',
        }),
      (error: unknown) => error instanceof EmailProviderError && error.kind === 'validation',
    );
  });

  it('maps 429 to rate_limit and retries then fails', async () => {
    let attempts = 0;
    const provider = new ForwardEmailProvider({
      apiToken: 'test-token',
      baseUrl: 'https://api.example.test',
      maxRetries: 1,
      fetchImpl: async () => {
        attempts += 1;
        return new Response('slow down', { status: 429 });
      },
    });
    await assert.rejects(
      () =>
        provider.send({
          to: 'hello@singletonsd.com',
          from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          subject: 'Hi',
          text: 'x',
        }),
      (error: unknown) =>
        error instanceof EmailProviderError &&
        error.kind === 'rate_limit' &&
        error.statusCode === 429,
    );
    assert.equal(attempts, 2);
  });

  it('does not retry permanent 4xx', async () => {
    let attempts = 0;
    const provider = new ForwardEmailProvider({
      apiToken: 'test-token',
      baseUrl: 'https://api.example.test',
      maxRetries: 3,
      fetchImpl: async () => {
        attempts += 1;
        return new Response('bad', { status: 400 });
      },
    });
    await assert.rejects(
      () =>
        provider.send({
          to: 'hello@singletonsd.com',
          from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          subject: 'Hi',
          text: 'x',
        }),
      (error: unknown) => error instanceof EmailProviderError && error.kind === 'permanent',
    );
    assert.equal(attempts, 1);
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new ForwardEmailProvider({
      apiToken: 'test-token',
      maxRetries: 0,
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    await assert.rejects(
      () =>
        provider.send(
          {
            to: 'hello@singletonsd.com',
            from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
            subject: 'Hi',
            text: 'x',
          },
          controller.signal,
        ),
      (error: unknown) => error instanceof EmailProviderError && error.kind === 'cancelled',
    );
  });
});

describe('DevelopmentEmailProvider', () => {
  it('captures mail without calling external APIs', async () => {
    const provider = new DevelopmentEmailProvider({ logMetadata: false });
    const result = await provider.send({
      to: 'hello@singletonsd.com',
      from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      fromName: 'Plattform Kit',
      replyTo: 'customer@example.com',
      subject: 'Hi',
      text: 'secret body',
    });
    assert.equal(result.accepted, true);
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0]?.replyTo, 'customer@example.com');
    assert.match(String(result.captured?.from), /Plattform Kit/);
  });
});

describe('createEmailProvider', () => {
  it('returns development provider by default', () => {
    const provider = createEmailProvider({ NODE_ENV: 'test' });
    assert.equal(provider.name, 'development');
  });
});
