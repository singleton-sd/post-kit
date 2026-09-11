import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostKitClient } from '@singleton-sd/post-kit-client';
import { handleSendTest } from './send-test-handler';

const TEST_KEY = 'test-key-not-a-real-credential';

function mockClient(fetchImpl: typeof fetch): PostKitClient {
  return new PostKitClient({
    endpoint: 'https://postkit.example',
    apiKey: TEST_KEY,
    fetch: fetchImpl,
  });
}

describe('handleSendTest', () => {
  it('sends with server-injected client and returns 202', async () => {
    let sawAuth = false;
    const client = mockClient(async (input, init) => {
      const headers = new Headers(init?.headers);
      sawAuth = headers.get('authorization') === `Bearer ${TEST_KEY}`;
      const body = JSON.parse(String(init?.body)) as {
        template: string;
        to: string;
        variables: Record<string, string>;
      };
      assert.equal(body.template, 'demo.welcome');
      assert.equal(body.to, 'ops@example.com');
      assert.equal(body.variables['name'], 'Ada');
      return new Response(JSON.stringify({ id: 'corr-1', status: 'sent' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await handleSendTest(
      {
        templateKey: 'demo.welcome',
        to: 'ops@example.com',
        variables: { name: 'Ada' },
        apiKey: 'attacker-supplied-ignored',
      },
      { client },
    );

    assert.equal(result.status, 202);
    assert.equal(sawAuth, true);
    if (result.status === 202) {
      assert.equal(result.body.correlationId, 'corr-1');
    }
  });

  it('rejects invalid templateKey and to before calling PostKit', async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    });

    const badKey = await handleSendTest(
      { templateKey: '../etc', to: 'a@b.co', variables: {} },
      { client },
    );
    assert.equal(badKey.status, 400);
    if (badKey.status === 400) assert.equal(badKey.body.field, 'templateKey');

    const badTo = await handleSendTest(
      { templateKey: 'demo.welcome', to: 'not-an-email', variables: {} },
      { client },
    );
    assert.equal(badTo.status, 400);
    if (badTo.status === 400) assert.equal(badTo.body.field, 'to');

    assert.equal(calls, 0);
  });

  it('maps PostKit failures to a generic 502', async () => {
    const logs: Array<{ event: string; detail: Record<string, unknown> }> = [];
    const client = mockClient(async () => new Response('nope', { status: 503 }));

    const result = await handleSendTest(
      { templateKey: 'demo.welcome', to: 'ops@example.com', variables: {} },
      {
        client,
        logError: (event, detail) => logs.push({ event, detail }),
      },
    );

    assert.equal(result.status, 502);
    if (result.status === 502) {
      assert.equal(result.body.error, 'Test email could not be sent. Please try again later.');
    }
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.event, 'admin.send_test.failed');
  });
});
