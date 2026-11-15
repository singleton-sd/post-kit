import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TEditorConfiguration } from '../../editor/core';
import { collectSubtreeBlockIds, deleteBlockSubtree } from './deleteBlockSubtree';

const nestedDoc = {
  root: {
    type: 'EmailLayout',
    data: { childrenIds: ['container-1'] },
  },
  'container-1': {
    type: 'Container',
    data: {
      props: { childrenIds: ['text-1', 'columns-1'] },
    },
  },
  'text-1': {
    type: 'Text',
    data: { props: { text: 'hello' } },
  },
  'columns-1': {
    type: 'ColumnsContainer',
    data: {
      props: {
        columns: [{ childrenIds: ['inner-a'] }, { childrenIds: [] }, undefined],
      },
    },
  },
  'inner-a': {
    type: 'Heading',
    data: { props: { text: 'col' } },
  },
  'orphan-keep': {
    type: 'Spacer',
    data: {},
  },
} as unknown as TEditorConfiguration;

describe('deleteBlockSubtree', () => {
  it('collects container and columns descendants', () => {
    const ids = collectSubtreeBlockIds(nestedDoc, 'container-1');
    assert.deepEqual(ids.sort(), ['columns-1', 'container-1', 'inner-a', 'text-1'].sort());
  });

  it('removes the full subtree and parent references without touching siblings', () => {
    const next = deleteBlockSubtree(nestedDoc, 'container-1');
    assert.equal(next['container-1'], undefined);
    assert.equal(next['text-1'], undefined);
    assert.equal(next['columns-1'], undefined);
    assert.equal(next['inner-a'], undefined);
    assert.ok(next['orphan-keep']);
    assert.deepEqual((next.root as { data: { childrenIds: string[] } }).data.childrenIds, []);
  });

  it('tolerates missing columns when deleting a sibling', () => {
    const next = deleteBlockSubtree(nestedDoc, 'orphan-keep');
    assert.equal(next['orphan-keep'], undefined);
    assert.ok(next['container-1']);
  });
});
