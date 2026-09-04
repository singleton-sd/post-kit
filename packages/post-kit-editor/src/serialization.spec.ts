import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compile } from '@singleton-sd/post-kit-compiler';
import { loadTemplateSource, serializeTemplateSource, TemplateSourceError } from './serialization';

const FIXTURES_DIR = join(import.meta.dirname, '__fixtures__');
const FIXTURE_NAMES = ['minimal', 'nested-blocks', 'unknown-field'] as const;

async function readFixture(name: (typeof FIXTURE_NAMES)[number]) {
  const dir = join(FIXTURES_DIR, name);
  const [templateJson, metadata, previewData] = await Promise.all([
    readFile(join(dir, 'template.json'), 'utf-8').then(JSON.parse),
    readFile(join(dir, 'metadata.json'), 'utf-8').then(JSON.parse),
    readFile(join(dir, 'preview.json'), 'utf-8').then(JSON.parse),
  ]);
  return { templateJson, metadata, previewData };
}

describe('loadTemplateSource()', () => {
  it('throws TemplateSourceError naming template.json when templateJson is not an object', () => {
    assert.throws(
      () =>
        loadTemplateSource({
          templateJson: null,
          metadata: { key: 'a', name: 'A', subject: 'Hi', variables: [], schemaVersion: '1' },
          previewData: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof TemplateSourceError);
        assert.equal(err.file, 'template.json');
        return true;
      },
    );
  });

  it('throws TemplateSourceError naming template.json when root block is missing', () => {
    assert.throws(
      () =>
        loadTemplateSource({
          templateJson: { document: {} },
          metadata: { key: 'a', name: 'A', subject: 'Hi', variables: [], schemaVersion: '1' },
          previewData: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof TemplateSourceError);
        assert.equal(err.file, 'template.json');
        return true;
      },
    );
  });

  for (const [label, root] of [
    ['null', null],
    ['array', []],
    ['missing type', { data: {} }],
    ['empty type', { type: '  ', data: {} }],
    ['missing data', { type: 'EmailLayout' }],
  ] as const) {
    it(`throws TemplateSourceError naming template.json when root is ${label}`, () => {
      assert.throws(
        () =>
          loadTemplateSource({
            templateJson: { root },
            metadata: { key: 'a', name: 'A', subject: 'Hi', variables: [], schemaVersion: '1' },
            previewData: {},
          }),
        (err: unknown) => {
          assert.ok(err instanceof TemplateSourceError);
          assert.equal(err.file, 'template.json');
          return true;
        },
      );
    });
  }

  it('throws TemplateSourceError naming metadata.json when schemaVersion is unknown', () => {
    assert.throws(
      () =>
        loadTemplateSource({
          templateJson: { root: { type: 'EmailLayout', data: {} } },
          metadata: {
            key: 'a',
            name: 'A',
            subject: 'Hi',
            variables: [],
            schemaVersion: '99',
          },
          previewData: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof TemplateSourceError);
        assert.equal(err.file, 'metadata.json');
        return true;
      },
    );
  });

  it('throws TemplateSourceError naming preview.json when preview data is not an object', () => {
    assert.throws(
      () =>
        loadTemplateSource({
          templateJson: { root: { type: 'EmailLayout', data: {} } },
          metadata: { key: 'a', name: 'A', subject: 'Hi', variables: [], schemaVersion: '1' },
          previewData: 'nope',
        }),
      (err: unknown) => {
        assert.ok(err instanceof TemplateSourceError);
        assert.equal(err.file, 'preview.json');
        return true;
      },
    );
  });
});

describe('serializeTemplateSource() round-trip', () => {
  for (const fixtureName of FIXTURE_NAMES) {
    it(`preserves all data for fixture "${fixtureName}"`, async () => {
      const input = await readFixture(fixtureName);
      const loaded = loadTemplateSource(input);
      const serialized = serializeTemplateSource(loaded);

      assert.equal(serialized.templateJson.endsWith('\n'), true);
      assert.equal(serialized.metadataJson.endsWith('\n'), true);
      assert.equal(serialized.previewJson.endsWith('\n'), true);

      const roundTripped = loadTemplateSource({
        templateJson: JSON.parse(serialized.templateJson),
        metadata: JSON.parse(serialized.metadataJson),
        previewData: JSON.parse(serialized.previewJson),
      });

      assert.deepEqual(roundTripped, loaded);
    });
  }

  it('produces deterministic output for the same input', async () => {
    const input = await readFixture('nested-blocks');
    const loaded = loadTemplateSource(input);
    const first = serializeTemplateSource(loaded);
    const second = serializeTemplateSource(loaded);
    assert.equal(first.templateJson, second.templateJson);
    assert.equal(first.metadataJson, second.metadataJson);
    assert.equal(first.previewJson, second.previewJson);
  });
});

describe('EmailBuilderDocument compiler compatibility', () => {
  it('accepts loaded templateJson in post-kit-compiler compile() without conversion', async () => {
    const input = await readFixture('nested-blocks');
    const loaded = loadTemplateSource(input);
    const result = await compile({
      templateJson: loaded.templateJson,
      metadata: loaded.metadata,
      previewData: loaded.previewData,
    });
    assert.ok(result.templateHtml.length > 0);
  });
});
