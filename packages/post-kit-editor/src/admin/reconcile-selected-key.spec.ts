import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reconcileSelectedKey } from './reconcile-selected-key';

describe('reconcileSelectedKey', () => {
  it('keeps the current key when it is still in the catalog', () => {
    assert.equal(reconcileSelectedKey('a', ['a', 'b']), 'a');
  });

  it('falls back to the first catalog key when selection is missing', () => {
    assert.equal(reconcileSelectedKey('gone', ['a', 'b']), 'a');
  });

  it('throws when the catalog is empty', () => {
    assert.throws(() => reconcileSelectedKey('a', []), /at least one/);
  });
});
