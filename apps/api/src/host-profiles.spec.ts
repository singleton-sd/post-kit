import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Function App host profiles', () => {
  it('wires CONTACT_EMAIL_PROFILES_BY_HOST in bicep app settings', () => {
    const bicep = readFileSync(
      path.resolve(__dirname, '../../../infra/function-app.bicep'),
      'utf8',
    );
    assert.match(bicep, /name: 'CONTACT_EMAIL_PROFILES_BY_HOST'/);
    assert.match(bicep, /param contactEmailProfilesByHost string/);
    assert.match(bicep, /inkads\.poc\.singletonsd\.com/);
  });
});
