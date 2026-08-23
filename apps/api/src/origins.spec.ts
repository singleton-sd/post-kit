import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedHostname, parseOrigins } from './origins';

describe('parseOrigins', () => {
  it('splits and trims hostnames', () => {
    assert.deepEqual(parseOrigins('a.example.com, localhost:4321 '), [
      'a.example.com',
      'localhost:4321',
    ]);
  });

  it('rejects empty ORIGINS', () => {
    assert.throws(() => parseOrigins(''), /ORIGINS/);
    assert.throws(() => parseOrigins(undefined), /ORIGINS/);
  });
});

describe('isAllowedHostname', () => {
  const marketingSwa = 'purple-field-05048bf00*.azurestaticapps.net';
  const allowlist = ['plattform-kit.poc.singletonsd.com', marketingSwa, 'localhost:4321'];

  it('allows exact custom-domain and localhost hosts', () => {
    assert.equal(isAllowedHostname('plattform-kit.poc.singletonsd.com', allowlist), true);
    assert.equal(isAllowedHostname('localhost:4321', allowlist), true);
  });

  it('allows marketing SWA default and PR preview hosts', () => {
    assert.equal(
      isAllowedHostname('purple-field-05048bf00.7.azurestaticapps.net', allowlist),
      true,
    );
    assert.equal(
      isAllowedHostname('purple-field-05048bf00-91.eastasia.7.azurestaticapps.net', allowlist),
      true,
    );
  });

  it('rejects other SWA instances and open multi-tenant wildcards', () => {
    assert.equal(
      isAllowedHostname('kind-rock-0f409fe00-57.eastasia.7.azurestaticapps.net', allowlist),
      false,
    );
    assert.equal(
      isAllowedHostname('attacker.7.azurestaticapps.net', ['*.azurestaticapps.net']),
      false,
    );
  });
});
