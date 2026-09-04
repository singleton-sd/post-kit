import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ColumnsContainerPropsSchema from './blocks/ColumnsContainerPropsSchema';
import { EditorBlock } from './EditorBlock';
import { CanvasEditorProvider } from './editor-context';

describe('ColumnsContainerPropsSchema', () => {
  it('preserves unknown props and column fields through parse', () => {
    const parsed = ColumnsContainerPropsSchema.parse({
      style: { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
      props: {
        columnsCount: 2,
        columnsGap: 16,
        futureEditorFlag: true,
        columns: [
          { childrenIds: ['a'], experimentalLayout: 'wide' },
          { childrenIds: ['b'] },
          { childrenIds: [] },
        ],
      },
    });

    assert.equal((parsed.props as { futureEditorFlag?: boolean } | null)?.futureEditorFlag, true);
    assert.equal(
      (parsed.props?.columns?.[0] as { experimentalLayout?: string }).experimentalLayout,
      'wide',
    );
    assert.deepEqual(parsed.props?.columns?.[0]?.childrenIds, ['a']);
  });

  it('preserves existing column fields when childrenIds are updated via merge', () => {
    const existing = ColumnsContainerPropsSchema.parse({
      style: {},
      props: {
        columns: [
          { childrenIds: ['old'], experimentalLayout: 'wide', unknownField: 1 },
          { childrenIds: [] },
          { childrenIds: [] },
        ],
      },
    });

    const nextColumns = [...(existing.props?.columns ?? [])];
    nextColumns[0] = {
      ...nextColumns[0],
      childrenIds: ['new'],
    };

    const updated = ColumnsContainerPropsSchema.parse({
      style: existing.style,
      props: {
        ...existing.props,
        columns: nextColumns,
      },
    });

    assert.deepEqual(updated.props?.columns?.[0]?.childrenIds, ['new']);
    assert.equal(
      (updated.props?.columns?.[0] as { experimentalLayout?: string }).experimentalLayout,
      'wide',
    );
    assert.equal((updated.props?.columns?.[0] as { unknownField?: number }).unknownField, 1);
  });
});

describe('Image block empty state', () => {
  it('renders a local empty state without remote image URLs when url is absent', () => {
    const markup = renderToStaticMarkup(
      <CanvasEditorProvider
        document={{
          root: {
            type: 'EmailLayout',
            data: { childrenIds: ['img-1'] },
          },
          'img-1': {
            type: 'Image',
            data: { props: {} },
          },
        }}
        onChange={() => undefined}
      >
        <EditorBlock id="img-1" />
      </CanvasEditorProvider>,
    );

    assert.match(markup, /pk-editor-image-empty/);
    assert.equal(markup.includes('placehold.co'), false);
    assert.equal(markup.includes('<img'), false);
  });
});
