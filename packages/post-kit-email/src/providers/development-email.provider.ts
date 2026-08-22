import type { EmailProvider, EmailSendRequest, EmailSendResult } from './email-types';
import { assertSafeEmailHeader, formatFromHeader } from './email-types';

export interface DevelopmentEmailProviderOptions {
  /** When true, logs metadata only (never full message bodies). Default true. */
  logMetadata?: boolean;
  logger?: Pick<Console, 'info'>;
}

/**
 * Safe preview/local sink — captures outbound mail in memory and never calls
 * an external provider. Selected by EMAIL_PROVIDER=development.
 */
export class DevelopmentEmailProvider implements EmailProvider {
  readonly name = 'development' as const;
  readonly sent: EmailSendRequest[] = [];
  private readonly logMetadata: boolean;
  private readonly logger: Pick<Console, 'info'>;

  constructor(options: DevelopmentEmailProviderOptions = {}) {
    this.logMetadata = options.logMetadata ?? true;
    this.logger = options.logger ?? console;
  }

  isConfigured(): boolean {
    return true;
  }

  async send(request: EmailSendRequest, signal?: AbortSignal): Promise<EmailSendResult> {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const to = Array.isArray(request.to) ? request.to : [request.to];
    to.forEach((v) => assertSafeEmailHeader(v, 'to'));
    assertSafeEmailHeader(request.from, 'from');
    assertSafeEmailHeader(request.subject, 'subject');
    if (request.replyTo) assertSafeEmailHeader(request.replyTo, 'replyTo');

    const captured: EmailSendRequest = {
      ...request,
      from: formatFromHeader(request.from, request.fromName),
    };
    this.sent.push(captured);

    if (this.logMetadata) {
      this.logger.info(
        JSON.stringify({
          msg: 'email.send.development',
          provider: this.name,
          operation: 'send',
          correlationId: request.correlationId,
          recipientDomain: to[0]?.split('@')[1],
          subjectLength: request.subject.length,
          hasHtml: Boolean(request.html),
          hasText: Boolean(request.text),
        }),
      );
    }

    return {
      providerMessageId: `dev-${this.sent.length}-${Date.now()}`,
      accepted: true,
      captured,
    };
  }
}
