import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  DEFAULT_SEND_MAX_BODY_BYTES,
  DEFAULT_SEND_MAX_VARIABLE_VALUE_BYTES,
  DEFAULT_SEND_MAX_VARIABLES_BYTES,
  getSendSizeLimits,
  resetSendSizeLimitsCache,
  validateRequestBodySize,
  validateVariablesSize,
} from './send-limits';

const touched = [
  'SEND_MAX_BODY_BYTES',
  'SEND_MAX_VARIABLES_BYTES',
  'SEND_MAX_VARIABLE_VALUE_BYTES',
];

function withEnv(keys: string[], run: () => void | Promise<void>): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const key of keys) {
    prior.set(key, process.env[key]);
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of prior) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetSendSizeLimitsCache();
    });
}

describe('validateRequestBodySize', () => {
  it('accepts a body within the default limit', () => {
    const limits = getSendSizeLimits();
    const body = JSON.stringify({ template: 't', to: 'a@b.com', variables: {} });
    const result = validateRequestBodySize(body, limits);
    assert.equal(result.ok, true);
  });

  it('rejects a body above the configured maximum with the limit in the message', () => {
    const limits = { maxBodyBytes: 10, maxVariablesBytes: 1000, maxVariableValueBytes: 100 };
    const body = 'x'.repeat(11);
    const result = validateRequestBodySize(body, limits);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /10/);
    }
  });
});

describe('validateVariablesSize', () => {
  it('accepts variables within default limits', () => {
    const limits = getSendSizeLimits();
    const result = validateVariablesSize({ name: 'Ada' }, limits);
    assert.equal(result.ok, true);
  });

  it('rejects when total serialized variables exceed the limit', () => {
    const limits = {
      maxBodyBytes: 1_000_000,
      maxVariablesBytes: 20,
      maxVariableValueBytes: 1_000,
    };
    const result = validateVariablesSize({ name: 'a'.repeat(30) }, limits);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /variables/);
      assert.match(result.error, /20/);
    }
  });

  it('rejects when a single variable value exceeds the per-value limit', () => {
    const limits = {
      maxBodyBytes: 1_000_000,
      maxVariablesBytes: 1_000_000,
      maxVariableValueBytes: 5,
    };
    const result = validateVariablesSize({ message: '123456' }, limits);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /message/);
      assert.match(result.error, /5/);
    }
  });
});

describe('getSendSizeLimits', () => {
  beforeEach(() => resetSendSizeLimitsCache());
  afterEach(() => resetSendSizeLimitsCache());

  it('uses documented defaults when env is unset', async () => {
    await withEnv(touched, () => {
      const limits = getSendSizeLimits();
      assert.equal(limits.maxBodyBytes, DEFAULT_SEND_MAX_BODY_BYTES);
      assert.equal(limits.maxVariablesBytes, DEFAULT_SEND_MAX_VARIABLES_BYTES);
      assert.equal(limits.maxVariableValueBytes, DEFAULT_SEND_MAX_VARIABLE_VALUE_BYTES);
    });
  });

  it('reads overrides from environment variables', async () => {
    await withEnv(touched, () => {
      process.env.SEND_MAX_BODY_BYTES = '4096';
      process.env.SEND_MAX_VARIABLES_BYTES = '2048';
      process.env.SEND_MAX_VARIABLE_VALUE_BYTES = '512';
      resetSendSizeLimitsCache();
      const limits = getSendSizeLimits();
      assert.equal(limits.maxBodyBytes, 4096);
      assert.equal(limits.maxVariablesBytes, 2048);
      assert.equal(limits.maxVariableValueBytes, 512);
    });
  });
});
