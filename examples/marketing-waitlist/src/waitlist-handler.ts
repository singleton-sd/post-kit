import { PostKitClient, PostKitRequestError } from '@singleton-sd/post-kit-client';

/**
 * Framework-agnostic waitlist / whitelist signup handler.
 *
 * Same public-form topology as Contact Us (`docs/guides/public-forms.md`), with
 * one intentional difference: the confirmation email is sent **to the submitted
 * address**. Template key stays server-owned. Caller-supplied `template` /
 * `to` / `from` / `subject` are ignored.
 *
 * Production hosts must still add captcha, per-IP **and** per-address rate
 * limits, and exactly one confirmation per submission — PostKit does not.
 */

/** Server-owned template key. Never read from the submission. */
export const WAITLIST_TEMPLATE_KEY = 'marketing.waitlist-confirm';

export const LIMITS = {
  nameMax: 120,
  emailMax: 254,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROLS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NAME_CONTROLS_RE = /[\u0000-\u001f\u007f]/;

export interface WaitlistDependencies {
  client: PostKitClient;
  /** Structured server-side log sink. Never write this detail to the response. */
  logError?: (event: string, detail: Record<string, unknown>) => void;
}

export type WaitlistResult =
  | { status: 202; body: { status: 'accepted' } }
  | { status: 400; body: { error: string; field: string } }
  | { status: 502; body: { error: string } };

interface ValidSubmission {
  email: string;
  name: string;
}

type ValidationOutcome =
  { ok: true; value: ValidSubmission } | { ok: false; field: string; error: string };

/**
 * Validate a waitlist signup and send a confirmation to the submitted email.
 */
export async function handleWaitlistSignup(
  submission: unknown,
  deps: WaitlistDependencies,
): Promise<WaitlistResult> {
  const validated = validateSubmission(submission);
  if (!validated.ok) {
    return { status: 400, body: { error: validated.error, field: validated.field } };
  }

  const { email, name } = validated.value;

  try {
    await deps.client.send({
      template: WAITLIST_TEMPLATE_KEY,
      to: email,
      variables: { email, name },
    });
  } catch (err) {
    deps.logError?.('waitlist.send.failed', {
      code: err instanceof PostKitRequestError ? err.code : 'UNKNOWN',
      status: err instanceof PostKitRequestError ? err.status : undefined,
      correlationId: err instanceof PostKitRequestError ? err.correlationId : undefined,
    });
    return {
      status: 502,
      body: { error: 'We could not complete your signup. Please try again shortly.' },
    };
  }

  return { status: 202, body: { status: 'accepted' } };
}

export function validateSubmission(submission: unknown): ValidationOutcome {
  if (submission === null || typeof submission !== 'object' || Array.isArray(submission)) {
    return { ok: false, field: 'body', error: 'Submission must be a JSON object.' };
  }

  const raw = submission as Record<string, unknown>;

  const email = readString(raw['email']).trim();
  if (!EMAIL_RE.test(email) || email.length > LIMITS.emailMax || CONTROLS_RE.test(email)) {
    return { ok: false, field: 'email', error: 'A valid email address is required.' };
  }

  // Name is optional; empty becomes a safe display fallback in the template.
  let name = readString(raw['name']).trim();
  if (!name) {
    name = 'there';
  } else if (name.length > LIMITS.nameMax || NAME_CONTROLS_RE.test(name)) {
    return {
      ok: false,
      field: 'name',
      error: `Name must be at most ${LIMITS.nameMax} characters.`,
    };
  }

  return { ok: true, value: { email, name } };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
