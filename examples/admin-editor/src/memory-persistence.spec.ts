import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadTemplateSource,
  serializeTemplateSource,
  type TemplateSourceFiles,
} from '@singleton-sd/post-kit-editor';

import { createMemoryPersistence, reconcileSelectedKey, toOnSave } from './memory-persistence';

import templateJson from '../sample/template.json';
import metadata from '../sample/metadata.json';
import previewData from '../sample/preview.json';

const seed: TemplateSourceFiles = loadTemplateSource({
  templateJson,
  metadata,
  previewData,
});

const other: TemplateSourceFiles = loadTemplateSource({
  templateJson,
  metadata: {
    ...metadata,
    key: 'auth.password-reset',
    name: 'Password reset',
    variables: ['resetUrl'],
  },
  previewData: { resetUrl: 'https://example.com/reset' },
});

describe('memory persistence adapter', () => {
  it('load returns the seeded source for a key', () => {
    const persistence = createMemoryPersistence({ [seed.metadata.key]: seed });
    const loaded = persistence.load(seed.metadata.key);

    assert.equal(loaded.metadata.key, 'demo.welcome');
    assert.equal(loaded.metadata.name, 'Welcome');
    assert.deepEqual(loaded.previewData, { name: 'Jane Doe' });
  });

  it('save round-trips serialized strings and structured files', async () => {
    const persistence = createMemoryPersistence({ [seed.metadata.key]: seed });
    const onSave = toOnSave(persistence);

    const next: TemplateSourceFiles = {
      ...seed,
      metadata: { ...seed.metadata, name: 'Welcome (edited)' },
      previewData: { name: 'Alex Example' },
    };
    const serialized = serializeTemplateSource(next);

    const result = await onSave(serialized, next);
    assert.deepEqual(result, { ok: true });

    const loaded = persistence.load('demo.welcome');
    assert.equal(loaded.metadata.name, 'Welcome (edited)');
    assert.deepEqual(loaded.previewData, { name: 'Alex Example' });
  });

  it('surfaces a save failure to the caller without writing', async () => {
    const persistence = createMemoryPersistence(
      { [seed.metadata.key]: seed },
      { failNextSave: true },
    );
    const onSave = toOnSave(persistence);

    const next: TemplateSourceFiles = {
      ...seed,
      metadata: { ...seed.metadata, name: 'Should not persist' },
    };
    const serialized = serializeTemplateSource(next);

    const result = await onSave(serialized, next);
    assert.deepEqual(result, { ok: false, message: 'Simulated save failure.' });

    const loaded = persistence.load(seed.metadata.key);
    assert.equal(loaded.metadata.name, 'Welcome');
  });

  it('load throws for an unknown key', () => {
    const persistence = createMemoryPersistence();
    assert.throws(() => persistence.load('missing.key'), /Template not found/);
  });

  it('syncCatalog preserves in-memory edits and drops removed keys', async () => {
    const persistence = createMemoryPersistence({ [seed.metadata.key]: seed });
    const edited: TemplateSourceFiles = {
      ...seed,
      metadata: { ...seed.metadata, name: 'Local edit' },
    };
    await toOnSave(persistence)(serializeTemplateSource(edited), edited);

    persistence.syncCatalog([
      { ...seed, metadata: { ...seed.metadata, name: 'Catalog overwrite attempt' } },
      other,
    ]);

    assert.equal(persistence.load('demo.welcome').metadata.name, 'Local edit');
    assert.equal(persistence.has('auth.password-reset'), true);

    persistence.syncCatalog([other]);
    assert.equal(persistence.has('demo.welcome'), false);
    assert.equal(persistence.has('auth.password-reset'), true);
  });
});

describe('reconcileSelectedKey', () => {
  it('keeps the selection when still in the catalog', () => {
    assert.equal(reconcileSelectedKey('demo.welcome', ['demo.welcome', 'other']), 'demo.welcome');
  });

  it('falls back when the selected template was removed', () => {
    assert.equal(
      reconcileSelectedKey('demo.welcome', ['auth.password-reset']),
      'auth.password-reset',
    );
  });
});
