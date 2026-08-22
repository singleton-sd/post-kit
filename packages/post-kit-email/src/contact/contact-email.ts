import { randomUUID } from 'node:crypto';
import type { EmailProvider, EmailSendRequest, EmailSendResult } from '../providers/email-types';
import { EmailProviderError, sanitizeHeaderValue } from '../providers/email-types';
import { resolveContactEmailProfile, type ContactEmailProfile } from './contact-email-profile';

export const CONTACT_SUBJECTS = ['general', 'sales', 'support', 'partnership'] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

export interface ContactInquiryInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export type ContactValidationResult =
  { ok: true; value: ContactInquiryInput } | { ok: false; status: 400; error: string };

const SUBJECT_LABELS: Record<ContactSubject, string> = {
  general: 'General inquiry',
  sales: 'Sales / demo request',
  support: 'Technical support',
  partnership: 'Partnership',
};

/** Practical email shape; rejects CR/LF and angle brackets. */
const EMAIL_RE = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

/** Reject C0 / DEL. Names: no newlines. Messages: allow LF and tab only. */
export function hasForbiddenControls(value: string, allowMessageWhitespace: boolean): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x7f) return true;
    if (code >= 0x20) continue;
    if (allowMessageWhitespace && (code === 0x09 || code === 0x0a)) continue;
    return true;
  }
  return false;
}

export function validateContactInquiry(body: unknown): ContactValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Expected a JSON object body.' };
  }
  const record = body as Record<string, unknown>;
  const nameRaw = typeof record.name === 'string' ? record.name.trim() : '';
  const emailRaw = typeof record.email === 'string' ? record.email.trim() : '';
  const subjectRaw = typeof record.subject === 'string' ? record.subject.trim() : '';
  const message = typeof record.message === 'string' ? record.message.trim() : '';

  if (!nameRaw || nameRaw.length > 120 || hasForbiddenControls(nameRaw, false)) {
    return { ok: false, status: 400, error: 'Enter a name (max 120 characters).' };
  }
  if (!EMAIL_RE.test(emailRaw) || emailRaw.length > 254 || hasForbiddenControls(emailRaw, false)) {
    return { ok: false, status: 400, error: 'Enter a valid email address.' };
  }
  if (!(CONTACT_SUBJECTS as readonly string[]).includes(subjectRaw)) {
    return { ok: false, status: 400, error: 'Select a valid subject.' };
  }
  if (message.length < 10 || message.length > 5000 || hasForbiddenControls(message, true)) {
    return { ok: false, status: 400, error: 'Enter a message of 10–5000 characters.' };
  }

  return {
    ok: true,
    value: {
      name: sanitizeHeaderValue(nameRaw),
      email: sanitizeHeaderValue(emailRaw),
      subject: subjectRaw as ContactSubject,
      message,
    },
  };
}

export function buildContactEmailRequest(
  dto: ContactInquiryInput,
  options: {
    inbox: string;
    from: string;
    fromName?: string;
    correlationId: string;
  },
): EmailSendRequest {
  const subjectLabel = SUBJECT_LABELS[dto.subject as ContactSubject];
  const text = [
    `New marketing contact inquiry (${subjectLabel})`,
    '',
    `Name: ${dto.name}`,
    `Email: ${dto.email}`,
    `Subject: ${subjectLabel}`,
    '',
    dto.message,
  ].join('\n');

  return {
    to: options.inbox,
    from: options.from,
    fromName: options.fromName,
    replyTo: dto.email,
    // Fixed label only — never interpolate free-text into the Subject header.
    subject: `[Plattform Kit] ${subjectLabel}`,
    text,
    correlationId: options.correlationId,
  };
}

export async function sendContactInquiryEmail(
  dto: ContactInquiryInput,
  email: EmailProvider,
  env: NodeJS.ProcessEnv = process.env,
  options: {
    tenantSettings?: Record<string, unknown> | null;
    /** Pre-validated host from an allowlist (never raw client Origin). */
    trustedRequestHost?: string | null;
    profileOverride?: Partial<ContactEmailProfile>;
  } = {},
): Promise<{ id: string; status: 'sent'; result: EmailSendResult }> {
  const profile = resolveContactEmailProfile({
    env,
    tenantSettings: options.tenantSettings,
    trustedRequestHost: options.trustedRequestHost,
    profileOverride: options.profileOverride,
  });

  if (!profile.contactInboxAddress || !profile.fromAddress) {
    throw new EmailProviderError({
      message: 'Contact email addresses are not configured',
      kind: 'configuration',
      provider: email.name,
    });
  }
  if (!email.isConfigured()) {
    throw new EmailProviderError({
      message:
        email.name === 'forward-email'
          ? 'FORWARD_EMAIL_TOKEN is not configured'
          : 'Email provider is not configured',
      kind: 'configuration',
      provider: email.name,
    });
  }

  const id = randomUUID();
  const request = buildContactEmailRequest(dto, {
    inbox: profile.contactInboxAddress,
    from: profile.fromAddress,
    fromName: profile.fromName,
    correlationId: id,
  });
  const result = await email.send(request);
  return { id, status: 'sent', result };
}
