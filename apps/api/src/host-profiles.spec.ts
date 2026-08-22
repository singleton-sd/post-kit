import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Function App host profiles', () => {
  it('seeds CONTACT host profiles in App Configuration, not Function app settings', () => {
    const root = path.resolve(__dirname, '../../..');
    const bicep = readFileSync(path.join(root, 'infra/function-app.bicep'), 'utf8');
    const seed = JSON.parse(
      readFileSync(path.join(root, 'infra/appconfig-seed.json'), 'utf8'),
    ) as Record<string, string>;

    assert.match(bicep, /ssd-postkit-appcs-prod-ae/);
    assert.match(bicep, /AZURE_APPCONFIGURATION_ENDPOINT/);
    assert.doesNotMatch(bicep, /name: 'CONTACT_EMAIL_PROFILES_BY_HOST'/);
    assert.ok(seed['app:email:profilesByHost']?.includes('inkads.poc.singletonsd.com'));
    assert.equal(seed['app:email:validation:domain'], 'mail.plattform-kit.poc.singletonsd.com');
  });
});
