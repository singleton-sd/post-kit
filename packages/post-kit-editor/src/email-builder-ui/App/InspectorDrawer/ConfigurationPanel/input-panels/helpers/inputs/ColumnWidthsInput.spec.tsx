import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ColumnWidthsInput from './ColumnWidthsInput';

describe('ColumnWidthsInput', () => {
  it('renders three column fields by default', () => {
    const html = renderToStaticMarkup(
      <ColumnWidthsInput defaultValue={[4, 4, 4]} onChange={() => undefined} />,
    );
    assert.match(html, /Column 1/);
    assert.match(html, /Column 2/);
    assert.match(html, /Column 3/);
  });

  it('omits Column 3 when columnsCount is 2', () => {
    const html = renderToStaticMarkup(
      <ColumnWidthsInput defaultValue={[6, 6, null]} columnsCount={2} onChange={() => undefined} />,
    );
    assert.match(html, /Column 1/);
    assert.match(html, /Column 2/);
    assert.doesNotMatch(html, /Column 3/);
  });
});
