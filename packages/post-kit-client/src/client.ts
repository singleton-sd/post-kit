import type { PostKitErrorResponse, SendRequest, SendResponse } from '@singleton-sd/post-kit-types';
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
  /** Injectable `fetch` implementation (defaults to `globalThis.fetch`). */
  fetch?: typeof globalThis.fetch;
}

export interface SendOptions {
  /** Optional abort signal threaded through to `fetch`. */
  signal?: AbortSignal;
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
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Send a templated email via `POST {endpoint}/emails/send`.
   */
  async send(request: SendRequest, options?: SendOptions): Promise<SendResponse> {
    const url = `${this.endpoint}/emails/send`;
    const signal = this.combineSignals(options?.signal);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      throw this.mapFetchError(err, options?.signal);
    }

    if (response.ok) {
      return (await response.json()) as SendResponse;
    }

    throw await this.mapHttpError(response);
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
      correlationId: body.correlationId,
    });
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
