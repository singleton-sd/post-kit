import assert from 'node:assert/strict';
import test from 'node:test';
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { WAITLIST_TEMPLATE_KEY, handleWaitlistSignup, LIMITS } from './waitlist-handler';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

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
};

test('valid signup sends confirmation to the submitted address', async () => {
  const { client, calls } = createHarness();

  const result = await handleWaitlistSignup(validSubmission, { client });

  assert.deepEqual(result, { status: 202, body: { status: 'accepted' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://postkit.example.com/emails/send');
  assert.deepEqual(calls[0]?.body, {
    template: WAITLIST_TEMPLATE_KEY,
    to: 'jane@example.com',
    variables: { email: 'jane@example.com', name: 'Jane Doe' },
  });
});

test('caller-supplied template/to/from/subject are ignored; to stays the signup email', async () => {
  const { client, calls } = createHarness();

  const result = await handleWaitlistSignup(
    {
      ...validSubmission,
      template: 'billing.invoice-paid',
      to: 'attacker@example.com',
      cc: 'attacker@example.com',
      from: 'spoofed@example.com',
      subject: 'Spoofed',
    },
    { client },
  );

  assert.equal(result.status, 202);
  assert.deepEqual(calls[0]?.body, {
    template: WAITLIST_TEMPLATE_KEY,
    to: 'jane@example.com',
    variables: { email: 'jane@example.com', name: 'Jane Doe' },
  });
});

test('omitted name uses a safe display fallback', async () => {
  const { client, calls } = createHarness();

  const result = await handleWaitlistSignup({ email: 'solo@example.com' }, { client });

  assert.equal(result.status, 202);
  assert.deepEqual(calls[0]?.body, {
    template: WAITLIST_TEMPLATE_KEY,
    to: 'solo@example.com',
    variables: { email: 'solo@example.com', name: 'there' },
  });
});

test('invalid submissions are rejected before any send', async () => {
  const cases: Array<{ label: string; input: unknown; field: string }> = [
    { label: 'not an object', input: 'email=x', field: 'body' },
    { label: 'array body', input: [validSubmission], field: 'body' },
    { label: 'missing email', input: { name: 'Jane' }, field: 'email' },
    {
      label: 'malformed email',
      input: { email: 'jane(at)example' },
      field: 'email',
    },
    {
      label: 'oversized name',
      input: { email: 'jane@example.com', name: 'a'.repeat(LIMITS.nameMax + 1) },
      field: 'name',
    },
  ];

  for (const c of cases) {
    const { client, calls } = createHarness();
    const result = await handleWaitlistSignup(c.input, { client });
    assert.equal(result.status, 400, c.label);
    if (result.status === 400) {
      assert.equal(result.body.field, c.field, c.label);
    }
    assert.equal(calls.length, 0, c.label);
  }
});

test('PostKit failures become a generic 502', async () => {
  const logs: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const { client } = createHarness(() => new Response('nope', { status: 503 }));

  const result = await handleWaitlistSignup(validSubmission, {
    client,
    logError: (event, detail) => logs.push({ event, detail }),
  });

  assert.equal(result.status, 502);
  if (result.status === 502) {
    assert.equal(result.body.error, 'We could not complete your signup. Please try again shortly.');
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.event, 'waitlist.send.failed');
});
