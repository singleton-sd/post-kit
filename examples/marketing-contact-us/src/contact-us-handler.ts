import { PostKitClient, PostKitRequestError } from '@singleton-sd/post-kit-client';

/**
 * Framework-agnostic "Contact Us" handler for a public marketing-site form.
 *
 * The only component in the request path that holds a PostKit credential is the
 * {@link PostKitClient} injected here. This module is server-only: it must never
 * be imported from browser code, and the browser must POST form fields to the
 * endpoint that wraps it rather than a `SendRequest`.
 *
 * See `docs/guides/public-forms.md` for the full topology and rationale.
 */

/** Server-owned template key. Never read from the submission. */
export const CONTACT_TEMPLATE_KEY = 'marketing.contact-us';

/** Limits mirror the repo's existing contact path (post-kit-email). */
export const LIMITS = {
  nameMax: 120,
  emailMax: 254,
  messageMin: 10,
  messageMax: 5000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Control characters are rejected outright; newlines are allowed in `message`. */
const CONTROLS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface ContactUsConfig {
  /**
   * Destination inbox, chosen by the deployment (e.g. `CONTACT_TO_ADDRESS`).
   * The submitted address is passed as a template variable so the team can
   * reply — it is never used as the recipient.
   */
  toAddress: string;
}

export interface ContactUsDependencies {
  client: PostKitClient;
  config: ContactUsConfig;
  /** Structured server-side log sink. Never write this detail to the response. */
  logError?: (event: string, detail: Record<string, unknown>) => void;
}

export type ContactUsResult =
  | { status: 202; body: { status: 'accepted' } }
  | { status: 400; body: { error: string; field: string } }
  | { status: 502; body: { error: string } };

interface ValidSubmission {
  name: string;
  email: string;
  message: string;
}

type ValidationOutcome =
  { ok: true; value: ValidSubmission } | { ok: false; field: string; error: string };

/**
 * Validate a parsed submission and, if it is acceptable, send it through
 * PostKit using the server-chosen template and recipient.
 *
 * `submission` is deliberately `unknown`: it is untrusted request data. Any
 * `template`, `to`, `from`, or `subject` field it carries is ignored.
 */
export async function handleContactUs(
  submission: unknown,
  deps: ContactUsDependencies,
): Promise<ContactUsResult> {
  const validated = validateSubmission(submission);
  if (!validated.ok) {
    return { status: 400, body: { error: validated.error, field: validated.field } };
  }

  const { name, email, message } = validated.value;

  try {
    await deps.client.send({
      template: CONTACT_TEMPLATE_KEY,
      to: deps.config.toAddress,
      variables: { name, email, message },
    });
  } catch (err) {
    // PostKit codes and correlation IDs are useful to operators and useful to
    // attackers. Log them; return a generic message.
    deps.logError?.('contact-us.send.failed', {
      code: err instanceof PostKitRequestError ? err.code : 'UNKNOWN',
      status: err instanceof PostKitRequestError ? err.status : undefined,
      correlationId: err instanceof PostKitRequestError ? err.correlationId : undefined,
    });
    return {
      status: 502,
      body: { error: 'We could not send your message. Please try again shortly.' },
    };
  }

  return { status: 202, body: { status: 'accepted' } };
}

export function validateSubmission(submission: unknown): ValidationOutcome {
  if (submission === null || typeof submission !== 'object' || Array.isArray(submission)) {
    return { ok: false, field: 'body', error: 'Submission must be a JSON object.' };
  }

  const raw = submission as Record<string, unknown>;

  const name = readString(raw['name']).trim();
  if (!name) {
    return { ok: false, field: 'name', error: 'Name is required.' };
  }
  if (name.length > LIMITS.nameMax || CONTROLS_RE.test(name)) {
    return {
      ok: false,
      field: 'name',
      error: `Name must be at most ${LIMITS.nameMax} characters.`,
    };
  }

  const email = readString(raw['email']).trim();
  if (!EMAIL_RE.test(email) || email.length > LIMITS.emailMax || CONTROLS_RE.test(email)) {
    return { ok: false, field: 'email', error: 'A valid email address is required.' };
  }

  const message = readString(raw['message']).trim();
  if (message.length < LIMITS.messageMin || message.length > LIMITS.messageMax) {
    return {
      ok: false,
      field: 'message',
      error: `Message must be between ${LIMITS.messageMin} and ${LIMITS.messageMax} characters.`,
    };
  }
  if (CONTROLS_RE.test(message)) {
    return { ok: false, field: 'message', error: 'Message contains unsupported characters.' };
  }

  return { ok: true, value: { name, email, message } };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
