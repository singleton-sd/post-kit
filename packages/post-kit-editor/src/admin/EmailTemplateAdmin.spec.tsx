import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadTemplateSource } from '../serialization';
import { ADMIN_CLASS_PREFIX, EmailTemplateAdmin } from './EmailTemplateAdmin';

import nestedTemplate from '../__fixtures__/nested-blocks/template.json';
import nestedMetadata from '../__fixtures__/nested-blocks/metadata.json';
import nestedPreview from '../__fixtures__/nested-blocks/preview.json';
import minimalTemplate from '../__fixtures__/minimal/template.json';
import minimalMetadata from '../__fixtures__/minimal/metadata.json';
import minimalPreview from '../__fixtures__/minimal/preview.json';

const nested = loadTemplateSource({
  templateJson: nestedTemplate,
  metadata: nestedMetadata,
  previewData: nestedPreview,
});

const minimal = loadTemplateSource({
  templateJson: minimalTemplate,
  metadata: minimalMetadata,
  previewData: minimalPreview,
});

describe('EmailTemplateAdmin', () => {
  it('renders list chrome, ThemeProvider tree, and MUI canvas surface', () => {
    const html = renderToStaticMarkup(
      <EmailTemplateAdmin templates={[nested, minimal]} onSave={() => undefined} />,
    );
    assert.match(html, new RegExp(`data-testid="${ADMIN_CLASS_PREFIX}root"`));
    assert.match(html, new RegExp(`data-testid="${ADMIN_CLASS_PREFIX}template-select"`));
    assert.match(html, /Email templates/);
    assert.match(html, /pk-editor-eb-mui-surface/);
    assert.match(html, />Samples</);
  });

  it('hides Send-test when onSendTest is omitted and shows it when provided', () => {
    const without = renderToStaticMarkup(
      <EmailTemplateAdmin templates={[nested]} onSave={() => undefined} />,
    );
    assert.doesNotMatch(without, /Send test|Send-test/i);

    const withSend = renderToStaticMarkup(
      <EmailTemplateAdmin
        templates={[nested]}
        onSave={() => undefined}
        onSendTest={() => undefined}
      />,
    );
    assert.match(withSend, /Send.test/i);
  });

  it('throws when templates is empty and not loading/loadError', () => {
    assert.throws(
      () => renderToStaticMarkup(<EmailTemplateAdmin templates={[]} onSave={() => undefined} />),
      /at least one template/,
    );
  });

  it('allows empty catalog while loading and renders loading shell', () => {
    const html = renderToStaticMarkup(
      <EmailTemplateAdmin templates={[]} loading onSave={() => undefined} />,
    );
    assert.match(html, new RegExp(`data-testid="${ADMIN_CLASS_PREFIX}root"`));
    assert.match(html, /pk-editor-loading/);
    assert.doesNotMatch(html, new RegExp(`data-testid="${ADMIN_CLASS_PREFIX}template-select"`));
  });

  it('allows empty catalog with loadError and renders error shell', () => {
    const html = renderToStaticMarkup(
      <EmailTemplateAdmin
        templates={[]}
        loadError="Synthetic catalog fetch failure."
        onSave={() => undefined}
      />,
    );
    assert.match(html, new RegExp(`data-testid="${ADMIN_CLASS_PREFIX}root"`));
    assert.match(html, /Synthetic catalog fetch failure/);
  });

  it('throws on duplicate metadata.key when not loading', () => {
    const dup = loadTemplateSource({
      templateJson: minimalTemplate,
      metadata: { ...minimalMetadata, key: nested.metadata.key },
      previewData: minimalPreview,
    });
    assert.throws(
      () =>
        renderToStaticMarkup(
          <EmailTemplateAdmin templates={[nested, dup]} onSave={() => undefined} />,
        ),
      /duplicate metadata\.key/,
    );
  });

  it('skips duplicate-key check while loading', () => {
    const dup = loadTemplateSource({
      templateJson: minimalTemplate,
      metadata: { ...minimalMetadata, key: nested.metadata.key },
      previewData: minimalPreview,
    });
    const html = renderToStaticMarkup(
      <EmailTemplateAdmin templates={[nested, dup]} loading onSave={() => undefined} />,
    );
    assert.match(html, /pk-editor-loading/);
  });
});
