import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Package tests avoid jsdom; assert the sync effect is present so
 * `defaultValue` prop changes update local slider state.
 */
describe('SliderInput prop sync', () => {
  it('resyncs local state when defaultValue changes', () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'SliderInput.tsx'),
      'utf8',
    );
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*setValue\(defaultValue\);\s*\}, \[defaultValue\]\)/s,
    );
  });
});
