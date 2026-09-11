import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { isPathInsideRoot } from './is-path-inside-root.mjs';

describe('isPathInsideRoot', () => {
  const root = path.resolve('/tmp/storybook-static');

  it('allows files under the static root', () => {
    assert.equal(isPathInsideRoot(root, path.join(root, 'index.html')), true);
    assert.equal(isPathInsideRoot(root, path.join(root, 'assets', 'app.js')), true);
  });

  it('rejects sibling directories that share a prefix', () => {
    assert.equal(isPathInsideRoot(root, path.resolve('/tmp/storybook-static-backup/x')), false);
  });

  it('rejects parent traversal', () => {
    assert.equal(isPathInsideRoot(root, path.join(root, '..', 'secret.txt')), false);
  });
});
