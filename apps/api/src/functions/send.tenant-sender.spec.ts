import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { HttpRequest, InvocationContext } from '@azure/functions';
import type { EmailProvider, EmailSendRequest } from '@singleton-sd/post-kit-email';
import {
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { clearTenantEmailConfigCache } from '../tenant';
import { createLogger } from '../telemetry';
import { createSendHandler } from './send';

const TENANT: TenantContext = { tenantId: 'inkads', environment: 'production' };

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>Hello {{name}}</p>',
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'Hi {{name}}',
    variables: ['name'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 'marketing.contact-us',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '2026-01-01T00:00:00.000Z',
    sourceCommit: '',
    variables: ['name'],
    contentHash: 'abc',
  },
};

function fakeRequest(json: unknown): HttpRequest {
  const textBody = JSON.stringify(json);
  return {
    method: 'POST',
    headers: { get: () => null },
    json: async () => json,
    text: async () => textBody,
  } as unknown as HttpRequest;
}

function fakeContext(): InvocationContext {
  return { error: () => undefined } as unknown as InvocationContext;
}

function fakeProvider(capture?: EmailSendRequest[]): EmailProvider {
  return {
    name: 'development',
    isConfigured: () => true,
    send: async (request) => {
      capture?.push(request);
      return { providerMessageId: 'msg-1', accepted: true };
    },
  };
}

describe('sendHandler — tenant-scoped sender configuration', () => {
  const touched = [
    'TENANT_EMAIL_CONFIG_BY_ID',
    'TENANT_PROVIDER_ACCOUNT_SECRETS',
    'EMAIL_FROM_ADDRESS',
    'EMAIL_FROM_NAME',
    'FORWARD_EMAIL_TOKEN_INKADS',
  ];
  const prior = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of touched) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    clearTenantEmailConfigCache();
  });

  afterEach(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearTenantEmailConfigCache();
  });

  it('applies tenant fromAddress, fromDisplayName, and replyTo to the outgoing message', async () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          fromDisplayName: 'InkAds',
          replyTo: 'support@inkads.example.com',
        },
      },
    });

    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: fakeProvider(sent),
    });

    const response = await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 200);
    assert.equal(sent[0]?.from, 'noreply@inkads.example.com');
    assert.equal(sent[0]?.fromName, 'InkAds');
    assert.equal(sent[0]?.replyTo, 'support@inkads.example.com');
  });

  it('ignores sender and reply-to fields in the request body', async () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          fromDisplayName: 'InkAds',
          replyTo: 'support@inkads.example.com',
        },
      },
    });

    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: fakeProvider(sent),
    });

    await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
        from: 'attacker@evil.example.com',
        fromAddress: 'attacker@evil.example.com',
        fromDisplayName: 'Evil',
        fromName: 'Evil',
        replyTo: 'attacker@evil.example.com',
        sender: 'attacker@evil.example.com',
      }),
      fakeContext(),
    );

    assert.equal(sent[0]?.from, 'noreply@inkads.example.com');
    assert.equal(sent[0]?.fromName, 'InkAds');
    assert.equal(sent[0]?.replyTo, 'support@inkads.example.com');
  });

  it('returns TENANT_CONFIG_NOT_FOUND when the tenant has no email configuration', async () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      other: { production: { fromAddress: 'noreply@other.example.com' } },
    });

    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: fakeProvider(),
    });

    const response = await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 503);
    assert.equal(
      (response.jsonBody as { code: string }).code,
      PostKitErrorCode.TENANT_CONFIG_NOT_FOUND,
    );
    assert.ok(
      !JSON.stringify(response.jsonBody).includes('noreply@other.example.com'),
      'must not leak another tenant sender',
    );
  });

  it('merges platform defaults only for fields the tenant has not overridden', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'platform@example.com';
    process.env.EMAIL_FROM_NAME = 'Platform';
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromDisplayName: 'InkAds',
        },
      },
    });

    const sent: EmailSendRequest[] = [];
    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: fakeProvider(sent),
    });

    await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
      }),
      fakeContext(),
    );

    assert.equal(sent[0]?.from, 'platform@example.com');
    assert.equal(sent[0]?.fromName, 'InkAds');
    assert.equal(sent[0]?.replyTo, undefined);
  });

  it('does not expose provider credentials in error responses or logs', async () => {
    const { EmailProviderError } = await import('@singleton-sd/post-kit-email');
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          providerAccount: 'inkads',
        },
      },
    });
    process.env.TENANT_PROVIDER_ACCOUNT_SECRETS = JSON.stringify({
      inkads: 'FORWARD_EMAIL_TOKEN_INKADS',
    });
    process.env.FORWARD_EMAIL_TOKEN_INKADS = 'super-secret-token';

    const lines: string[] = [];
    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: {
        name: 'development',
        isConfigured: () => true,
        send: async () => {
          throw new EmailProviderError({
            message: 'boom',
            kind: 'permanent',
            provider: 'development',
          });
        },
      },
      createLogger: (correlationId) => createLogger(correlationId, (line) => lines.push(line)),
    });

    const response = await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 502);
    const serialized = JSON.stringify({ body: response.jsonBody, logs: lines });
    assert.ok(!serialized.includes('super-secret-token'));
    assert.ok(!serialized.includes('FORWARD_EMAIL_TOKEN_INKADS'));
  });

  it('does not expose provider account identifiers when provider secret map is malformed', async () => {
    process.env.TENANT_EMAIL_CONFIG_BY_ID = JSON.stringify({
      inkads: {
        production: {
          fromAddress: 'noreply@inkads.example.com',
          providerAccount: 'configured-account-id',
        },
      },
    });
    process.env.TENANT_PROVIDER_ACCOUNT_SECRETS = JSON.stringify({
      'configured-account-id': 123,
    });

    const handler = createSendHandler({
      tenantResolver: { resolve: async () => TENANT },
      templateStore: { load: async () => COMPILED },
      emailProvider: fakeProvider(),
    });

    const response = await handler(
      fakeRequest({
        template: 'marketing.contact-us',
        to: 'user@example.com',
        variables: { name: 'Ada' },
      }),
      fakeContext(),
    );

    assert.equal(response.status, 503);
    const body = response.jsonBody as { error: string };
    assert.ok(!body.error.includes('configured-account-id'));
  });
});
