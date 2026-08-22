/** Provider-independent outbound email types for the Notifications pillar. */

export type EmailProviderName = 'forward-email' | 'development';

export interface EmailSendRequest {
  to: string | string[];
  /** Envelope From address (never a customer-supplied address). */
  from: string;
  /** Optional display name rendered as `"Name" <from@domain>`. */
  fromName?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  correlationId?: string;
}

export interface EmailSendResult {
  providerMessageId: string;
  accepted: boolean;
  /** Captured messages when using the development provider. */
  captured?: EmailSendRequest;
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  isConfigured(): boolean;
  send(request: EmailSendRequest, signal?: AbortSignal): Promise<EmailSendResult>;
}

export type EmailProviderErrorKind =
  'configuration' | 'validation' | 'rate_limit' | 'transient' | 'permanent' | 'cancelled';

export class EmailProviderError extends Error {
  readonly kind: EmailProviderErrorKind;
  readonly provider: EmailProviderName;
  readonly statusCode?: number;
  readonly providerRequestId?: string;
  readonly correlationId?: string;
  readonly retryable: boolean;

  readonly cause?: unknown;

  constructor(options: {
    message: string;
    kind: EmailProviderErrorKind;
    provider: EmailProviderName;
    statusCode?: number;
    providerRequestId?: string;
    correlationId?: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'EmailProviderError';
    this.kind = options.kind;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.providerRequestId = options.providerRequestId;
    this.correlationId = options.correlationId;
    this.cause = options.cause;
    this.retryable =
      options.retryable ?? (options.kind === 'transient' || options.kind === 'rate_limit');
  }
}

/** Format a From header without allowing CR/LF injection. */
export function formatFromHeader(from: string, fromName?: string): string {
  const address = sanitizeHeaderValue(from);
  if (!fromName?.trim()) return address;
  const name = sanitizeHeaderValue(fromName).replace(/"/g, '');
  return `"${name}" <${address}>`;
}

export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]/g, '').trim();
}

export function assertSafeEmailHeader(value: string, field: string): string {
  const cleaned = sanitizeHeaderValue(value);
  if (!cleaned) {
    throw new EmailProviderError({
      message: `${field} is required`,
      kind: 'validation',
      provider: 'forward-email',
    });
  }
  if (/[\r\n]/.test(value)) {
    throw new EmailProviderError({
      message: `${field} contains invalid control characters`,
      kind: 'validation',
      provider: 'forward-email',
    });
  }
  return cleaned;
}
