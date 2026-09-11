import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TEditorConfiguration } from '../../editor/core';
import cloneDocumentBlock, { createBlockId } from './cloneDocumentBlock';

describe('cloneDocumentBlock', () => {
  it('creates collision-safe ids that do not overwrite existing keys', () => {
    const document = {
      root: { type: 'EmailLayout', data: { childrenIds: ['a'] } },
      a: { type: 'Text', data: { props: { text: 'x' } } },
    } as unknown as TEditorConfiguration;

    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = createBlockId(document);
      assert.equal(Object.prototype.hasOwnProperty.call(document, id), false);
      assert.equal(ids.has(id), false);
      ids.add(id);
      document[id] = { type: 'Spacer', data: {} } as TEditorConfiguration[string];
    }
  });

  it('clones ColumnsContainer with missing/partial columns without throwing', () => {
    const document = {
      root: { type: 'EmailLayout', data: { childrenIds: ['cols'] } },
      cols: {
        type: 'ColumnsContainer',
        data: {
          props: {
            columns: [{ childrenIds: ['child'] }, undefined],
          },
        },
      },
      child: { type: 'Text', data: { props: { text: 'c' } } },
    } as unknown as TEditorConfiguration;

    const { document: next, blockId } = cloneDocumentBlock(document, 'cols');
    assert.ok(next[blockId]);
    const cloned = next[blockId] as {
      type: string;
      data: { props: { columns: Array<{ childrenIds: string[] } | undefined> } };
    };
    assert.equal(cloned.type, 'ColumnsContainer');
    assert.equal(cloned.data.props.columns[0]?.childrenIds.length, 1);
    assert.notEqual(cloned.data.props.columns[0]?.childrenIds[0], 'child');
  });
});
