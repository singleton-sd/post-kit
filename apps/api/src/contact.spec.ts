import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DevelopmentEmailProvider } from '@singleton-sd/post-kit-email';
import {
  buildContactEmailRequest,
  contactCorsHeaders,
  resolveContactEmailProvider,
  resolveTrustedContactHost,
  submitContactInquiry,
  validateContactInquiry,
} from './contact';
import { SlidingWindowRateLimiter, clientIpFromHeaders } from './contact-rate-limit';

function withEnv(keys: string[], run: () => void | Promise<void>): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const key of keys) {
    prior.set(key, process.env[key]);
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of prior) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

describe('validateContactInquiry', () => {
  it('accepts a valid payload', () => {
    const result = validateContactInquiry({
      name: 'Jane Doe',
      email: 'jane@acme.com',
      subject: 'sales',
      message: 'I would like a demo of Platform Kit.',
    });
    assert.equal(result.ok, true);
  });

  it('rejects CR/LF/NUL in name (header-injection surface)', () => {
    const withCrLf = validateContactInquiry({
      name: 'Alice\r\nBcc: victim@evil.com',
      email: 'jane@acme.com',
      subject: 'sales',
      message: 'I would like a demo of Platform Kit.',
    });
    assert.equal(withCrLf.ok, false);
  });
});

describe('contact send', () => {
  it('forces development provider for SWA preview origins', () => {
    const provider = resolveContactEmailProvider('https://nice-wave-123.azurestaticapps.net', {
      EMAIL_PROVIDER: 'forward-email',
      FORWARD_EMAIL_TOKEN: 'secret',
      EMAIL_ALLOW_PRODUCTION_SEND: 'true',
    });
    assert.equal(provider.name, 'development');
  });

  it('applies host-based sender profile override when configured', async () => {
    const email = new DevelopmentEmailProvider({ logMetadata: false });
    const result = await submitContactInquiry(
      {
        name: 'Jane Doe',
        email: 'jane@acme.com',
        subject: 'support',
        message: 'Please help with setup details for this PoC.',
      },
      {
        requestOrigin: 'https://inkads.poc.singletonsd.com',
        email,
        env: {
          ORIGINS: 'inkads.poc.singletonsd.com',
          EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          EMAIL_FROM_NAME: 'Plattform Kit',
          CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
          CONTACT_EMAIL_PROFILES_BY_HOST: JSON.stringify({
            'inkads.poc.singletonsd.com': {
              fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
              fromName: 'InkAds',
              contactInboxAddress: 'inkads-support@singletonsd.com',
            },
          }),
        },
      },
    );
    assert.equal(result.status, 'sent');
    assert.equal(email.sent[0]?.to, 'inkads-support@singletonsd.com');
    assert.match(String(email.sent[0]?.from), /noreply@mail\.inkads\.poc\.singletonsd\.com/);
  });

  it('ignores host profile overrides for untrusted Origin hosts', async () => {
    const email = new DevelopmentEmailProvider({ logMetadata: false });
    const result = await submitContactInquiry(
      {
        name: 'Jane Doe',
        email: 'jane@acme.com',
        subject: 'support',
        message: 'Please help with setup details for this PoC.',
      },
      {
        requestOrigin: 'https://evil.example.com',
        email,
        env: {
          ORIGINS: 'inkads.poc.singletonsd.com',
          EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
          CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
          CONTACT_EMAIL_PROFILES_BY_HOST: JSON.stringify({
            'evil.example.com': {
              fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
              contactInboxAddress: 'inkads-support@singletonsd.com',
            },
          }),
        },
      },
    );
    assert.equal(result.status, 'sent');
    assert.equal(email.sent[0]?.to, 'hello@singletonsd.com');
  });
});

describe('resolveTrustedContactHost', () => {
  it('returns the host when Origin matches ORIGINS allowlist', () => {
    assert.equal(
      resolveTrustedContactHost('https://inkads.poc.singletonsd.com', {
        ORIGINS: 'inkads.poc.singletonsd.com',
      }),
      'inkads.poc.singletonsd.com',
    );
  });

  it('returns null for hosts outside the allowlist', () => {
    assert.equal(
      resolveTrustedContactHost('https://evil.example.com', {
        ORIGINS: 'inkads.poc.singletonsd.com',
      }),
      null,
    );
  });
});

describe('contactCorsHeaders', () => {
  it('reflects allowed marketing origins', async () => {
    await withEnv(['ORIGINS'], () => {
      process.env.ORIGINS = 'plattform-kit.poc.singletonsd.com,localhost:4321';
      const headers = contactCorsHeaders('https://plattform-kit.poc.singletonsd.com');
      assert.equal(
        headers['Access-Control-Allow-Origin'],
        'https://plattform-kit.poc.singletonsd.com',
      );
    });
  });

  it('omits Allow-Origin for unknown hosts', async () => {
    await withEnv(['ORIGINS'], () => {
      process.env.ORIGINS = 'plattform-kit.poc.singletonsd.com';
      const headers = contactCorsHeaders('https://evil.example');
      assert.equal(headers['Access-Control-Allow-Origin'], undefined);
    });
  });
});

describe('SlidingWindowRateLimiter', () => {
  it('allows up to max then returns 429-style deny', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    const t0 = 1_000_000;
    assert.equal(limiter.tryConsume('1.1.1.1', t0).allowed, true);
    assert.equal(limiter.tryConsume('1.1.1.1', t0 + 1).allowed, true);
    const denied = limiter.tryConsume('1.1.1.1', t0 + 2);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSec >= 1);
  });

  it('isolates keys and prefers the platform client address', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000);
    assert.equal(limiter.tryConsume('a', 1).allowed, true);
    assert.equal(limiter.tryConsume('b', 1).allowed, true);

    const xff = new Map([['x-forwarded-for', '203.0.113.9, 10.0.0.1']]);
    assert.equal(clientIpFromHeaders({ get: (n) => xff.get(n) ?? null }), '10.0.0.1');

    const azure = new Map([
      ['x-forwarded-for', '203.0.113.9, 10.0.0.1'],
      ['x-azure-clientip', '198.51.100.7'],
    ]);
    assert.equal(clientIpFromHeaders({ get: (n) => azure.get(n) ?? null }), '198.51.100.7');
  });

  it('evicts inactive buckets after the window', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000);
    assert.equal(limiter.tryConsume('stale', 1).allowed, true);
    assert.equal(limiter.size, 1);
    assert.equal(limiter.tryConsume('fresh', 2_000).allowed, true);
    assert.equal(limiter.size, 1);
  });
});
