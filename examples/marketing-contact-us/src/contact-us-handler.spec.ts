import assert from 'node:assert/strict';
import test from 'node:test';
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { CONTACT_TEMPLATE_KEY, handleContactUs, LIMITS } from './contact-us-handler';

const TO_ADDRESS = 'inbox@example.com';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Build a client over a mock `fetch`. No network call is ever made, and no real
 * credential is used — `test-key-not-a-real-credential` is a literal.
 */
function createHarness(
  respond: (call: RecordedCall) => Response = () =>
    new Response(JSON.stringify({ id: 'corr-1', status: 'sent' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
): { client: PostKitClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const call: RecordedCall = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    };
    calls.push(call);
    return respond(call);
  };

  const client = new PostKitClient({
    endpoint: 'https://postkit.example.com',
    apiKey: 'test-key-not-a-real-credential',
    fetch: fetchMock,
  });

  return { client, calls };
}

const validSubmission = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'I would like to hear more about your product.',
};

test('valid submission sends with the server-chosen template and recipient', async () => {
  const { client, calls } = createHarness();

  const result = await handleContactUs(validSubmission, {
    client,
    config: { toAddress: TO_ADDRESS },
  });

  assert.deepEqual(result, { status: 202, body: { status: 'accepted' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://postkit.example.com/emails/send');
  assert.deepEqual(calls[0]?.body, {
    template: CONTACT_TEMPLATE_KEY,
    to: TO_ADDRESS,
    variables: validSubmission,
  });
});

test('the credential travels only on the server-side request', async () => {
  const { client, calls } = createHarness();

  await handleContactUs(validSubmission, { client, config: { toAddress: TO_ADDRESS } });

  // The handler never sees or forwards the key: the injected client owns it.
  assert.equal(calls[0]?.headers['Authorization'], 'Bearer test-key-not-a-real-credential');
});

test('caller-supplied template and recipient fields are ignored', async () => {
  const { client, calls } = createHarness();

  const result = await handleContactUs(
    {
      ...validSubmission,
      template: 'billing.invoice-paid',
      to: 'attacker@example.com',
      cc: 'attacker@example.com',
      from: 'spoofed@example.com',
      subject: 'Spoofed subject',
    },
    { client, config: { toAddress: TO_ADDRESS } },
  );

  assert.equal(result.status, 202);
  assert.deepEqual(calls[0]?.body, {
    template: CONTACT_TEMPLATE_KEY,
    to: TO_ADDRESS,
    variables: validSubmission,
  });
});

test('invalid submissions are rejected before any send', async () => {
  const cases: Array<{ label: string; input: unknown; field: string }> = [
    { label: 'not an object', input: 'name=Jane', field: 'body' },
    { label: 'array body', input: [validSubmission], field: 'body' },
    { label: 'missing name', input: { ...validSubmission, name: '   ' }, field: 'name' },
    {
      label: 'oversized name',
      input: { ...validSubmission, name: 'a'.repeat(LIMITS.nameMax + 1) },
      field: 'name',
    },
    {
      label: 'malformed email',
      input: { ...validSubmission, email: 'jane(at)example' },
      field: 'email',
    },
    {
      label: 'oversized email',
      input: { ...validSubmission, email: `${'a'.repeat(LIMITS.emailMax)}@example.com` },
      field: 'email',
    },
    { label: 'non-string message', input: { ...validSubmission, message: 42 }, field: 'message' },
    {
      label: 'message too short',
      input: { ...validSubmission, message: 'too short' },
      field: 'message',
    },
    {
      label: 'oversized message',
      input: { ...validSubmission, message: 'a'.repeat(LIMITS.messageMax + 1) },
      field: 'message',
    },
    {
      label: 'control characters in message',
      input: { ...validSubmission, message: `hello there\u0000injected` },
      field: 'message',
    },
  ];

  for (const testCase of cases) {
    const { client, calls } = createHarness();

    const result = await handleContactUs(testCase.input, {
      client,
      config: { toAddress: TO_ADDRESS },
    });

    assert.equal(result.status, 400, testCase.label);
    assert.equal(calls.length, 0, `${testCase.label}: must not reach PostKit`);
    assert.equal(
      result.status === 400 ? result.body.field : undefined,
      testCase.field,
      testCase.label,
    );
  }
});

test('a PostKit failure becomes a generic error and is logged, not leaked', async () => {
  const { client } = createHarness(
    () =>
      new Response(
        JSON.stringify({
          error: 'Template artifact billing.invoice-paid was not found.',
          code: 'TEMPLATE_NOT_FOUND',
          correlationId: 'corr-secret',
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  const logged: Array<{ event: string; detail: Record<string, unknown> }> = [];

  const result = await handleContactUs(validSubmission, {
    client,
    config: { toAddress: TO_ADDRESS },
    logError: (event, detail) => logged.push({ event, detail }),
  });

  assert.deepEqual(result, {
    status: 502,
    body: { error: 'We could not send your message. Please try again shortly.' },
  });

  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes('TEMPLATE_NOT_FOUND'));
  assert.ok(!serialised.includes('corr-secret'));

  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.event, 'contact-us.send.failed');
  assert.equal(logged[0]?.detail['code'], 'TEMPLATE_NOT_FOUND');
  assert.equal(logged[0]?.detail['status'], 404);
  assert.equal(logged[0]?.detail['correlationId'], 'corr-secret');
});

test('a network-level failure is also surfaced generically', async () => {
  const calls: string[] = [];
  const client = new PostKitClient({
    endpoint: 'https://postkit.example.com',
    apiKey: 'test-key-not-a-real-credential',
    fetch: async () => {
      calls.push('attempted');
      throw new Error('socket hang up');
    },
  });

  const logged: Array<Record<string, unknown>> = [];
  const result = await handleContactUs(validSubmission, {
    client,
    config: { toAddress: TO_ADDRESS },
    logError: (_event, detail) => logged.push(detail),
  });

  assert.equal(result.status, 502);
  assert.equal(calls.length, 1);
  assert.equal(logged[0]?.['code'], 'NETWORK_ERROR');
});
