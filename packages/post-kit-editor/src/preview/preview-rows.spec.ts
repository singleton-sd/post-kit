import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addPreviewKey, buildPreviewRows, removePreviewKey, setPreviewValue } from './preview-rows';

describe('buildPreviewRows', () => {
  it('includes declared variables missing from previewData as empty rows', () => {
    const rows = buildPreviewRows(['name', 'email'], { name: 'Jane' });
    assert.deepEqual(rows, [
      { key: 'name', value: 'Jane', extra: false },
      { key: 'email', value: '', extra: false },
    ]);
  });

  it('marks undeclared preview keys as extra and sortable', () => {
    const rows = buildPreviewRows(['name'], {
      name: 'Jane',
      zz: 'tail',
      bonus: 'extra',
    });
    assert.deepEqual(rows, [
      { key: 'name', value: 'Jane', extra: false },
      { key: 'bonus', value: 'extra', extra: true },
      { key: 'zz', value: 'tail', extra: true },
    ]);
  });

  it('collapses duplicate declared variable names to the first occurrence', () => {
    const rows = buildPreviewRows(['name', 'email', 'name'], { name: 'Jane' });
    assert.deepEqual(rows, [
      { key: 'name', value: 'Jane', extra: false },
      { key: 'email', value: '', extra: false },
    ]);
  });
});

describe('preview data mutations', () => {
  it('setPreviewValue writes declared-but-missing keys into preview data', () => {
    const next = setPreviewValue({ name: 'Jane' }, 'email', 'jane@example.com');
    assert.deepEqual(next, { name: 'Jane', email: 'jane@example.com' });
  });

  it('removePreviewKey drops extras and clears declared keys from the object', () => {
    assert.deepEqual(removePreviewKey({ name: 'Jane', bonus: 'x' }, 'bonus'), {
      name: 'Jane',
    });
    assert.deepEqual(removePreviewKey({ name: 'Jane' }, 'name'), {});
  });

  it('addPreviewKey rejects blank or duplicate keys', () => {
    assert.equal(addPreviewKey({ name: 'Jane' }, '  '), null);
    assert.equal(addPreviewKey({ name: 'Jane' }, 'name'), null);
    assert.deepEqual(addPreviewKey({ name: 'Jane' }, 'email'), {
      name: 'Jane',
      email: '',
    });
  });
});
