import { PostKitClient, PostKitRequestError } from '@singleton-sd/post-kit-client';
import { PostKitErrorCode, type SendRequest } from '@singleton-sd/post-kit-types';

/** Template key of the compiled artifact this example sends. */
export const PASSWORD_RESET_TEMPLATE = 'auth.password-reset';

export interface PasswordResetInput {
  /** Recipient address. */
  email: string;
  /** Single-use reset link. Generate it server-side; never log it. */
  resetUrl: string;
  /** Display name used in the greeting. */
  name: string;
}

export type PasswordResetResult =
  | { outcome: 'sent'; id: string }
  | {
      /** Transient failure — safe to retry with backoff. */
      outcome: 'retryable';
      code: string;
      status: number | undefined;
      correlationId: string | undefined;
    }
  | {
      /** Permanent failure — retrying the same request will fail again. */
      outcome: 'permanent';
      code: string;
      status: number | undefined;
      correlationId: string | undefined;
    };

const RETRYABLE_CODES: ReadonlySet<string> = new Set<string>([
  PostKitErrorCode.PROVIDER_FAILURE,
  PostKitErrorCode.STORAGE_FAILURE,
  'TIMEOUT',
  'NETWORK_ERROR',
]);

/**
 * Send the password-reset email for one user.
 *
 * Runs on a trusted server only — the `PostKitClient` passed in holds a
 * long-lived API key that must never reach browser code.
 */
export async function sendPasswordReset(
  client: PostKitClient,
  input: PasswordResetInput,
  options?: { signal?: AbortSignal },
): Promise<PasswordResetResult> {
  const request: SendRequest = {
    template: PASSWORD_RESET_TEMPLATE,
    to: input.email,
    // Every variable value must be a string — the API rejects other types.
    variables: {
      name: input.name,
      resetUrl: input.resetUrl,
    },
  };

  try {
    const response = await client.send(request, options);
    return { outcome: 'sent', id: response.id };
  } catch (err) {
    if (!(err instanceof PostKitRequestError)) {
      throw err;
    }
    return {
      outcome: RETRYABLE_CODES.has(err.code) ? 'retryable' : 'permanent',
      code: err.code,
      status: err.status,
      correlationId: err.correlationId,
    };
  }
}
