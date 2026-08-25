import type { PostKitErrorCode } from '@singleton-sd/post-kit-types';

/**
 * Error thrown by {@link PostKitClient} for HTTP, timeout, and network failures.
 *
 * `code` is a {@link PostKitErrorCode} from the API, or `'TIMEOUT'` / `'NETWORK_ERROR'`
 * for client-side failures.
 */
export class PostKitRequestError extends Error {
  readonly status: number | undefined;
  readonly code: PostKitErrorCode | 'TIMEOUT' | 'NETWORK_ERROR' | string;
  readonly correlationId: string | undefined;

  constructor(options: {
    message: string;
    code: PostKitErrorCode | 'TIMEOUT' | 'NETWORK_ERROR' | string;
    status?: number;
    correlationId?: string;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'PostKitRequestError';
    this.status = options.status;
    this.code = options.code;
    this.correlationId = options.correlationId;
    if (options.cause !== undefined) {
      // Assign after super for ES2021 targets without ErrorOptions in lib.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
