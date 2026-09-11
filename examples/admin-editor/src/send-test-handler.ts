import { PostKitClient, PostKitRequestError } from '@singleton-sd/post-kit-client';

/**
 * Framework-agnostic Send-test BFF for an admin host embedding
 * `@singleton-sd/post-kit-editor`.
 *
 * Browser → `POST /api/email-templates/send-test` (your route) → this handler
 * → `PostKitClient.send`. The PostKit API key never leaves the server.
 *
 * The template must already be **published** to Blob for the tenant/environment
 * bound to the Bearer credential. Draft-only Git files are not sendable until CI
 * runs `post-kit-publish`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_KEY_RE = /^[a-zA-Z0-9._-]+$/;

export const SEND_TEST_LIMITS = {
  emailMax: 254,
  templateKeyMax: 128,
} as const;

export interface SendTestDependencies {
  client: PostKitClient;
  logError?: (event: string, detail: Record<string, unknown>) => void;
}

export type SendTestResult =
  | { status: 202; body: { status: 'accepted'; correlationId?: string } }
  | { status: 400; body: { error: string; field: string } }
  | { status: 502; body: { error: string } };

interface ValidSendTest {
  templateKey: string;
  to: string;
  variables: Record<string, string>;
}

/**
 * Validate an untrusted JSON body and send a test email through PostKit.
 * Ignores any `apiKey` / `endpoint` / `from` fields on the body.
 */
export async function handleSendTest(
  body: unknown,
  deps: SendTestDependencies,
): Promise<SendTestResult> {
  const validated = validateSendTestBody(body);
  if (!validated.ok) {
    return { status: 400, body: { error: validated.error, field: validated.field } };
  }

  const { templateKey, to, variables } = validated.value;

  try {
    const response = await deps.client.send({
      template: templateKey,
      to,
      variables,
    });
    return {
      status: 202,
      body: { status: 'accepted', correlationId: response.id },
    };
  } catch (err) {
    if (err instanceof PostKitRequestError) {
      deps.logError?.('admin.send_test.failed', {
        code: err.code,
        status: err.status,
        correlationId: err.correlationId,
      });
    } else {
      deps.logError?.('admin.send_test.failed', {
        name: err instanceof Error ? err.name : 'Error',
      });
    }
    return {
      status: 502,
      body: { error: 'Test email could not be sent. Please try again later.' },
    };
  }
}

type ValidationOutcome =
  { ok: true; value: ValidSendTest } | { ok: false; field: string; error: string };

function validateSendTestBody(body: unknown): ValidationOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body', error: 'Request body must be a JSON object.' };
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj['templateKey'] !== 'string' || obj['templateKey'].trim() === '') {
    return { ok: false, field: 'templateKey', error: 'templateKey is required.' };
  }
  const templateKey = obj['templateKey'].trim();
  if (
    templateKey.length > SEND_TEST_LIMITS.templateKeyMax ||
    !TEMPLATE_KEY_RE.test(templateKey) ||
    templateKey === '.' ||
    templateKey === '..'
  ) {
    return { ok: false, field: 'templateKey', error: 'templateKey is invalid.' };
  }

  if (typeof obj['to'] !== 'string' || obj['to'].trim() === '') {
    return { ok: false, field: 'to', error: 'to is required.' };
  }
  const to = obj['to'].trim();
  if (to.length > SEND_TEST_LIMITS.emailMax || !EMAIL_RE.test(to)) {
    return { ok: false, field: 'to', error: 'to must be a valid email address.' };
  }

  const variables = normalizeVariables(obj['variables']);
  if (!variables.ok) {
    return variables;
  }

  return { ok: true, value: { templateKey, to, variables: variables.value } };
}

function normalizeVariables(
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; field: string; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: {} };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, field: 'variables', error: 'variables must be an object of strings.' };
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return {
        ok: false,
        field: 'variables',
        error: 'variables must be an object of strings.',
      };
    }
    out[key] = entry;
  }
  return { ok: true, value: out };
}
