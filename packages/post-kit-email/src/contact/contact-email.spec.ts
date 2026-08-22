import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContactEmailRequest,
  sendContactInquiryEmail,
  validateContactInquiry,
} from './contact-email';
import { DevelopmentEmailProvider } from '../providers/development-email.provider';

describe('validateContactInquiry', () => {
  it('accepts a valid payload', () => {
    const result = validateContactInquiry({
      name: 'Jane Doe',
      email: 'jane@acme.com',
      subject: 'general',
      message: 'Hello, I would like a demo.',
    });
    assert.equal(result.ok, true);
  });

  it('rejects malformed email', () => {
    const result = validateContactInquiry({
      name: 'Jane',
      email: 'not-an-email',
      subject: 'general',
      message: 'Hello, I would like a demo.',
    });
    assert.equal(result.ok, false);
  });

  it('rejects header injection in email', () => {
    const result = validateContactInquiry({
      name: 'Jane',
      email: 'jane@acme.com\nBcc: leak@x.com',
      subject: 'general',
      message: 'Hello, I would like a demo.',
    });
    assert.equal(result.ok, false);
  });
});

describe('buildContactEmailRequest / sendContactInquiryEmail', () => {
  it('keeps noreply as From and customer as Reply-To', async () => {
    const provider = new DevelopmentEmailProvider({ logMetadata: false });
    const dto = {
      name: 'Jane Doe',
      email: 'jane@acme.com',
      subject: 'sales',
      message: 'Please contact me about Plattform Kit.',
    };
    const built = buildContactEmailRequest(dto, {
      inbox: 'hello@singletonsd.com',
      from: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      fromName: 'Plattform Kit',
      correlationId: 'corr-1',
    });
    assert.equal(built.to, 'hello@singletonsd.com');
    assert.equal(built.from, 'noreply@mail.plattform-kit.poc.singletonsd.com');
    assert.equal(built.replyTo, 'jane@acme.com');
    assert.equal(built.subject, '[Plattform Kit] Sales / demo request');
    assert.notEqual(built.from, dto.email);

    const sent = await sendContactInquiryEmail(dto, provider, {
      EMAIL_PROVIDER: 'development',
      EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
      EMAIL_FROM_NAME: 'Plattform Kit',
      CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
    });
    assert.equal(sent.status, 'sent');
    assert.equal(provider.sent[0]?.replyTo, 'jane@acme.com');
    assert.equal(provider.sent[0]?.to, 'hello@singletonsd.com');
  });

  it('uses tenant email settings overrides when provided', async () => {
    const provider = new DevelopmentEmailProvider({ logMetadata: false });
    const dto = {
      name: 'Jane Doe',
      email: 'jane@acme.com',
      subject: 'support',
      message: 'Please help with our tenant onboarding.',
    };

    const sent = await sendContactInquiryEmail(
      dto,
      provider,
      {
        EMAIL_PROVIDER: 'development',
        EMAIL_FROM_ADDRESS: 'noreply@mail.plattform-kit.poc.singletonsd.com',
        EMAIL_FROM_NAME: 'Plattform Kit',
        CONTACT_INBOX_ADDRESS: 'hello@singletonsd.com',
      },
      {
        tenantSettings: {
          email: {
            fromAddress: 'noreply@mail.inkads.poc.singletonsd.com',
            fromName: 'InkAds',
            contactInboxAddress: 'inkads-support@singletonsd.com',
          },
        },
      },
    );

    assert.equal(sent.status, 'sent');
    assert.equal(provider.sent[0]?.to, 'inkads-support@singletonsd.com');
    assert.match(String(provider.sent[0]?.from), /noreply@mail\.inkads\.poc\.singletonsd\.com/);
  });
});
