/**
 * Send-path timeout, failure classification, and idempotency-gated retry.
 *
 * Provider calls are always bounded by a configurable timeout. Internal retries
 * run only for transient failures and only when the request holds an
 * Idempotency-Key claim (so a retry cannot become a second delivered email).
 * Without that claim, the caller gets a single attempt (at-least-once).
 *
 * @see docs/architecture/send-timeout-retry.md
 */

import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendRequest,
  type EmailSendResult,
} from '@singleton-sd/post-kit-email';

/** Azure Functions Consumption (Y1) default execution limit. */
export const DEFAULT_FUNCTION_TIMEOUT_MS = 300_000;

/** Leave headroom for auth, template load, render, and idempotency I/O. */
export const SEND_RETRY_BUDGET_HEADROOM_MS = 60_000;

/** Per-attempt provider timeout (must sit well under the function limit). */
export const DEFAULT_SEND_PROVIDER_TIMEOUT_MS = 15_000;

/** Max provider attempts when an Idempotency-Key claim is held. */
export const DEFAULT_SEND_MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff between attempts (ms). */
export const DEFAULT_SEND_RETRY_BASE_DELAY_MS = 250;

/** Cap for a single backoff sleep. */
export const SEND_RETRY_MAX_DELAY_MS = 2_000;

export type FailureClass = 'transient' | 'permanent';

/**
 * Stable typed error when the send-path timeout aborts the provider call.
 * Classified as transient; retryable only under an idempotency claim.
 */
export class SendTimeoutError extends Error {
  readonly failureClass: FailureClass = 'transient';
  readonly failureCategory = 'timeout';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Provider send timed out after ${timeoutMs}ms`);
    this.name = 'SendTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Final classified delivery failure after timeout/retry policy has run.
 * `cause` is the underlying provider/timeout error for HTTP mapping.
 */
export class DeliveryFailureError extends Error {
  readonly attempts: number;
  readonly failureClass: FailureClass;
  readonly failureCategory: string;
  readonly cause: unknown;

  constructor(options: {
    cause: unknown;
    attempts: number;
    failureClass: FailureClass;
    failureCategory: string;
  }) {
    const message =
      options.cause instanceof Error ? options.cause.message : 'Provider delivery failed';
    super(message);
    this.name = 'DeliveryFailureError';
    this.cause = options.cause;
    this.attempts = options.attempts;
    this.failureClass = options.failureClass;
    this.failureCategory = options.failureCategory;
  }
}

export interface SendDeliveryPolicy {
  /** Abort each provider.send after this many ms. */
  providerTimeoutMs: number;
  /**
   * Max attempts when `allowRetry` is true (idempotency claim held).
   * Always 1 when retry is not allowed.
   */
  maxAttempts: number;
  /** Base delay for exponential backoff. */
  retryBaseDelayMs: number;
  /** Documented Function App execution limit used for budget checks. */
  functionTimeoutMs: number;
  /** Total worst-case provider+backoff budget for maxAttempts. */
  retryBudgetMs: number;
}

export interface ClassifiedFailure {
  failureClass: FailureClass;
  /** Stable category for logs / delivery telemetry (not provider-specific DTOs). */
  failureCategory: string;
  /** Whether send-path retry may consider this failure (still requires idempotency). */
  retryable: boolean;
}

export interface DeliveryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  failureClass?: FailureClass;
  failureCategory?: string;
}

export interface SuccessfulDelivery {
  ok: true;
  result: EmailSendResult;
  attempts: number;
  failureClass?: undefined;
  failureCategory?: undefined;
}

export interface FailedDelivery {
  ok: false;
  error: unknown;
  attempts: number;
  failureClass: FailureClass;
  failureCategory: string;
}

/** Internal delivery result — never leaked as a public API DTO. */
export type DeliveryResult = SuccessfulDelivery | FailedDelivery;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Worst-case time for `maxAttempts` timeouts plus exponential backoffs between them.
 */
export function computeRetryBudgetMs(
  maxAttempts: number,
  providerTimeoutMs: number,
  retryBaseDelayMs: number,
): number {
  const attempts = Math.max(1, maxAttempts);
  let budget = attempts * providerTimeoutMs;
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    budget += Math.min(SEND_RETRY_MAX_DELAY_MS, retryBaseDelayMs * 2 ** attempt);
  }
  return budget;
}

/**
 * Resolve timeout / retry knobs from env and clamp so the retry budget fits
 * inside the Function App execution limit (minus headroom).
 */
export function resolveSendDeliveryPolicy(
  env: NodeJS.ProcessEnv = process.env,
): SendDeliveryPolicy {
  const functionTimeoutMs = parsePositiveInt(env.FUNCTION_TIMEOUT_MS, DEFAULT_FUNCTION_TIMEOUT_MS);
  const providerTimeoutMs = parsePositiveInt(
    env.SEND_PROVIDER_TIMEOUT_MS,
    DEFAULT_SEND_PROVIDER_TIMEOUT_MS,
  );
  const retryBaseDelayMs = parsePositiveInt(
    env.SEND_RETRY_BASE_DELAY_MS,
    DEFAULT_SEND_RETRY_BASE_DELAY_MS,
  );
  let maxAttempts = parsePositiveInt(env.SEND_MAX_ATTEMPTS, DEFAULT_SEND_MAX_ATTEMPTS);

  const available = Math.max(providerTimeoutMs, functionTimeoutMs - SEND_RETRY_BUDGET_HEADROOM_MS);
  while (
    maxAttempts > 1 &&
    computeRetryBudgetMs(maxAttempts, providerTimeoutMs, retryBaseDelayMs) > available
  ) {
    maxAttempts -= 1;
  }

  // A single attempt must still fit; if timeout alone exceeds available, keep it
  // but document that operators must lower SEND_PROVIDER_TIMEOUT_MS.
  const retryBudgetMs = computeRetryBudgetMs(maxAttempts, providerTimeoutMs, retryBaseDelayMs);

  return {
    providerTimeoutMs,
    maxAttempts,
    retryBaseDelayMs,
    functionTimeoutMs,
    retryBudgetMs,
  };
}

/**
 * Map provider / timeout outcomes onto transient vs permanent.
 * Provider-specific shapes stay inside EmailProviderError; only class + category
 * are exposed to the send handler and logs.
 */
export function classifySendFailure(error: unknown): ClassifiedFailure {
  if (error instanceof SendTimeoutError) {
    return {
      failureClass: 'transient',
      failureCategory: error.failureCategory,
      retryable: true,
    };
  }

  if (error instanceof EmailProviderError) {
    // Timeout abort is surfaced by some providers as cancelled with our reason.
    if (
      error.kind === 'cancelled' &&
      (error.cause instanceof SendTimeoutError ||
        (error.cause instanceof Error && error.cause.name === 'SendTimeoutError'))
    ) {
      return {
        failureClass: 'transient',
        failureCategory: 'timeout',
        retryable: true,
      };
    }

    switch (error.kind) {
      case 'transient':
      case 'rate_limit':
        return {
          failureClass: 'transient',
          failureCategory: error.failureCategory,
          retryable: true,
        };
      case 'permanent':
      case 'validation':
      case 'configuration':
      case 'cancelled':
        return {
          failureClass: 'permanent',
          failureCategory: error.failureCategory,
          retryable: false,
        };
      default: {
        const _exhaustive: never = error.kind;
        return {
          failureClass: 'permanent',
          failureCategory: String(_exhaustive),
          retryable: false,
        };
      }
    }
  }

  return {
    failureClass: 'transient',
    failureCategory: 'unhandled',
    retryable: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, baseDelayMs: number): number {
  return Math.min(SEND_RETRY_MAX_DELAY_MS, baseDelayMs * 2 ** attempt);
}

/**
 * Call provider.send with an AbortSignal that fires after `timeoutMs`.
 * Always throws {@link SendTimeoutError} (never a hung promise) on timeout.
 */
export async function sendWithTimeout(
  provider: EmailProvider,
  request: EmailSendRequest,
  timeoutMs: number,
): Promise<EmailSendResult> {
  const timeoutError = new SendTimeoutError(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  try {
    return await provider.send(request, controller.signal);
  } catch (error) {
    if (error instanceof SendTimeoutError) {
      throw error;
    }
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof SendTimeoutError) {
        throw reason;
      }
      if (
        error instanceof EmailProviderError &&
        error.kind === 'cancelled' &&
        (error.cause instanceof SendTimeoutError || reason instanceof SendTimeoutError)
      ) {
        throw timeoutError;
      }
      // AbortError from fetch when our timer fired.
      if (error instanceof Error && error.name === 'AbortError') {
        throw timeoutError;
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface DeliverOptions {
  policy: SendDeliveryPolicy;
  /**
   * When true (Idempotency-Key claim held), transient failures may be retried
   * up to `policy.maxAttempts` while reusing the same claim.
   */
  allowRetry: boolean;
  onAttempt?: (info: DeliveryAttemptInfo) => void;
  /** Injectable sleep for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Bound provider delivery with timeout and optional idempotency-gated retry.
 * Returns a classified {@link DeliveryResult}; does not throw.
 */
export async function deliverSend(
  provider: EmailProvider,
  request: EmailSendRequest,
  options: DeliverOptions,
): Promise<DeliveryResult> {
  const maxAttempts = options.allowRetry ? options.policy.maxAttempts : 1;
  const sleepFn = options.sleepFn ?? sleep;
  let lastError: unknown;
  let lastClassified: ClassifiedFailure = {
    failureClass: 'transient',
    failureCategory: 'unhandled',
    retryable: true,
  };
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    try {
      const result = await sendWithTimeout(provider, request, options.policy.providerTimeoutMs);
      options.onAttempt?.({ attempt, maxAttempts });
      return { ok: true, result, attempts: attempt };
    } catch (error) {
      lastError = error;
      lastClassified = classifySendFailure(error);
      options.onAttempt?.({
        attempt,
        maxAttempts,
        failureClass: lastClassified.failureClass,
        failureCategory: lastClassified.failureCategory,
      });

      const canRetry =
        options.allowRetry &&
        lastClassified.retryable &&
        lastClassified.failureClass === 'transient' &&
        attempt < maxAttempts;

      if (!canRetry) {
        break;
      }

      await sleepFn(backoffMs(attempt, options.policy.retryBaseDelayMs));
    }
  }

  return {
    ok: false,
    error: new DeliveryFailureError({
      cause: lastError,
      attempts: attemptsUsed,
      failureClass: lastClassified.failureClass,
      failureCategory: lastClassified.failureCategory,
    }),
    attempts: attemptsUsed,
    failureClass: lastClassified.failureClass,
    failureCategory: lastClassified.failureCategory,
  };
}
