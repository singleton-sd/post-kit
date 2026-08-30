import type { PostKitErrorResponse, SendRequest, SendResponse } from '@singleton-sd/post-kit-types';
import { isValidCorrelationId } from './correlation';
import { PostKitRequestError } from './errors';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options for {@link PostKitClient}.
 *
 * Auth is configured here (Bearer `apiKey`) so the strategy can evolve without
 * changing the `send()` surface.
 */
export interface PostKitClientOptions {
  /** Base URL of the PostKit API (trailing slash is stripped). */
  endpoint: string;
  /** Bearer token for the `Authorization` header. */
  apiKey: string;
  /**
   * Request timeout in milliseconds. Defaults to `30_000`.
   * Pass `0` to disable the client timeout (the request then runs until the
   * optional per-call `AbortSignal` fires, or indefinitely if none is given).
   */
  timeout?: number;
  /**
   * Default correlation ID sent as `x-correlation-id` on every `send()` call.
   * Per-request `SendOptions.correlationId` overrides this value.
   */
  correlationId?: string;
  /** Injectable `fetch` implementation (defaults to `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
}

export interface SendOptions {
  /** Optional abort signal threaded through to `fetch`. */
  signal?: AbortSignal;
  /**
   * Correlation ID for this request, sent as `x-correlation-id`.
   * Overrides a client-level default when both are set.
   */
  correlationId?: string;
}

/**
 * Thin typed client for trusted server-side callers of the PostKit API.
 *
 * Do not embed long-lived API keys in browser code. Public forms must POST to
 * your own server endpoint, which then calls PostKit with this client.
 */
export class PostKitClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly defaultCorrelationId: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: PostKitClientOptions) {
    if (!options.endpoint) {
      throw new Error('PostKitClient: endpoint is required');
    }
    if (!options.apiKey) {
      throw new Error('PostKitClient: apiKey is required');
    }
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultCorrelationId = options.correlationId;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Send a templated email via `POST {endpoint}/emails/send`.
   */
  async send(request: SendRequest, options?: SendOptions): Promise<SendResponse> {
    const url = `${this.endpoint}/emails/send`;
    const callerSignal = options?.signal;
    const correlationId = options?.correlationId ?? this.defaultCorrelationId;

    if (correlationId !== undefined) {
      this.assertValidCorrelationId(correlationId);
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (correlationId !== undefined) {
        headers['x-correlation-id'] = correlationId;
      }

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: this.combineSignals(callerSignal),
      });

      if (response.ok) {
        return (await response.json()) as SendResponse;
      }

      throw await this.mapHttpError(response);
    } catch (err) {
      if (err instanceof PostKitRequestError) {
        throw err;
      }
      throw this.mapFetchError(err, callerSignal);
    }
  }

  private combineSignals(callerSignal: AbortSignal | undefined): AbortSignal | undefined {
    const signals: AbortSignal[] = [];
    if (callerSignal) {
      signals.push(callerSignal);
    }
    if (this.timeoutMs > 0) {
      signals.push(AbortSignal.timeout(this.timeoutMs));
    }
    if (signals.length === 0) {
      return undefined;
    }
    if (signals.length === 1) {
      return signals[0];
    }
    return AbortSignal.any(signals);
  }

  private mapFetchError(err: unknown, callerSignal: AbortSignal | undefined): never {
    if (isTimeoutLikeError(err)) {
      if (callerSignal?.aborted) {
        throw err;
      }
      throw new PostKitRequestError({
        message: 'PostKit request timed out',
        code: 'TIMEOUT',
        cause: err,
      });
    }

    if (isAbortError(err)) {
      if (callerSignal?.aborted) {
        throw err;
      }
      throw new PostKitRequestError({
        message: 'PostKit request timed out',
        code: 'TIMEOUT',
        cause: err,
      });
    }

    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new PostKitRequestError({
      message,
      code: 'NETWORK_ERROR',
      cause: err,
    });
  }

  private async mapHttpError(response: Response): Promise<never> {
    let body: Partial<PostKitErrorResponse> = {};
    try {
      body = (await response.json()) as Partial<PostKitErrorResponse>;
    } catch {
      // Non-JSON error body — fall through with empty fields.
    }

    const message =
      typeof body.error === 'string' && body.error.length > 0
        ? body.error
        : `PostKit request failed with status ${response.status}`;

    throw new PostKitRequestError({
      message,
      code: body.code ?? `HTTP_${response.status}`,
      status: response.status,
      correlationId: body.correlationId ?? response.headers.get('X-Correlation-Id') ?? undefined,
    });
  }

  private assertValidCorrelationId(correlationId: string): void {
    if (!isValidCorrelationId(correlationId)) {
      throw new PostKitRequestError({
        message: 'Invalid correlation ID',
        code: 'INVALID_CORRELATION_ID',
      });
    }
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError')
  );
}

function isTimeoutLikeError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'TimeoutError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'TimeoutError')
  );
}
