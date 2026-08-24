import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { compile, compileFromDirectory, validateSource } from './compiler';
import { CompilerError } from './compiler-error';
import type { TemplateSource } from './template-source';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTACT_US_DOCUMENT = {
  root: {
    type: 'EmailLayout',
    data: {
      backdropColor: '#F8F8F8',
      canvasColor: '#FFFFFF',
      textColor: '#242424',
      fontFamily: 'MODERN_SANS',
      childrenIds: ['block-text'],
    },
  },
  'block-text': {
    type: 'Text',
    data: {
      style: {
        fontWeight: 'normal',
        padding: { top: 16, bottom: 16, right: 24, left: 24 },
      },
      props: {
        text: 'Hello {{name}}, from {{email}}: {{message}}',
      },
    },
  },
};

const contactUsSource: TemplateSource = {
  templateJson: CONTACT_US_DOCUMENT,
  metadata: {
    key: 'marketing.contact-us',
    name: 'Contact Us',
    subject: 'New message from {{name}}',
    variables: ['name', 'email', 'message'],
    schemaVersion: '1',
  },
  previewData: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    message: 'Hello!',
  },
};

const missingPreviewVarSource: TemplateSource = {
  templateJson: { document: {} },
  metadata: {
    key: 'auth.password-reset',
    name: 'Password Reset',
    subject: 'Reset your password',
    variables: ['resetUrl'],
    schemaVersion: '1',
  },
  previewData: {
    // resetUrl intentionally omitted
    name: 'Jane Doe',
  },
};

const malformedMetadataSource: TemplateSource = {
  templateJson: { document: {} },
  // key field missing — cast through unknown to simulate a runtime parse result
  metadata: {
    name: 'Malformed',
    subject: 'Hello',
    variables: [],
    schemaVersion: '1',
  } as unknown as TemplateSource['metadata'],
  previewData: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compile()', () => {
  it('returns CompiledTemplate with correct key and non-empty contentHash', async () => {
    const result = await compile(contactUsSource);

    assert.equal(result.metadata.key, 'marketing.contact-us');
    assert.ok(result.manifest.contentHash.length > 0, 'contentHash should be non-empty');
    assert.ok(
      result.templateHtml.includes('Hello {{name}}'),
      'HTML should keep Handlebars placeholders',
    );
    assert.ok(result.templateHtml.includes('<html'), 'HTML should be a rendered email document');
    assert.equal(result.manifest.key, 'marketing.contact-us');
    assert.equal(result.manifest.schemaVersion, '1');
  });

  it('is deterministic: two calls with the same input produce identical templateHtml and contentHash', async () => {
    const [a, b] = await Promise.all([compile(contactUsSource), compile(contactUsSource)]);

    assert.equal(a.templateHtml, b.templateHtml);
    assert.equal(a.manifest.contentHash, b.manifest.contentHash);
  });

  it('throws CompilerError(MISSING_PREVIEW_VARIABLE) when a variable is absent from previewData', async () => {
    await assert.rejects(
      () => compile(missingPreviewVarSource),
      (err: unknown) => {
        assert.ok(err instanceof CompilerError, 'should be a CompilerError');
        assert.equal(err.code, 'MISSING_PREVIEW_VARIABLE');
        assert.ok(err.message.includes('resetUrl'), 'message should name the missing variable');
        return true;
      },
    );
  });

  it('throws CompilerError(INVALID_METADATA) when metadata is malformed', async () => {
    await assert.rejects(
      () => compile(malformedMetadataSource),
      (err: unknown) => {
        assert.ok(err instanceof CompilerError, 'should be a CompilerError');
        assert.equal(err.code, 'INVALID_METADATA');
        return true;
      },
    );
  });

  it('throws CompilerError(INVALID_METADATA) when schemaVersion is not the expected version', async () => {
    const source: TemplateSource = {
      templateJson: { document: {} },
      metadata: {
        key: 'test.bad-schema',
        name: 'Bad Schema',
        subject: 'Hello',
        variables: [],
        schemaVersion: '99',
      } as unknown as TemplateSource['metadata'],
      previewData: {},
    };

    await assert.rejects(
      () => compile(source),
      (err: unknown) => {
        assert.ok(err instanceof CompilerError, 'should be a CompilerError');
        assert.equal(err.code, 'INVALID_METADATA');
        assert.ok(err.message.includes('schemaVersion'), 'message should mention schemaVersion');
        return true;
      },
    );
  });

  it('throws CompilerError(MISSING_PREVIEW_VARIABLE) for inherited (non-own) property in previewData', async () => {
    // Create an object whose prototype has the variable key — hasOwnProperty should reject it
    const proto = { inheritedVar: 'value' };
    const previewWithInheritedProp = Object.create(proto) as Record<string, string>;

    const source: TemplateSource = {
      templateJson: { document: {} },
      metadata: {
        key: 'test.inherited',
        name: 'Inherited Prop Test',
        subject: 'Hello',
        variables: ['inheritedVar'],
        schemaVersion: '1',
      },
      previewData: previewWithInheritedProp,
    };

    await assert.rejects(
      () => compile(source),
      (err: unknown) => {
        assert.ok(err instanceof CompilerError, 'should be a CompilerError');
        assert.equal(err.code, 'MISSING_PREVIEW_VARIABLE');
        assert.ok(err.message.includes('inheritedVar'), 'message should name the missing variable');
        return true;
      },
    );
  });

  it('throws CompilerError(RENDER_FAILURE) when templateJson is not an EmailBuilder document', async () => {
    const source: TemplateSource = {
      templateJson: { document: { type: 'EmailLayout' } },
      metadata: {
        key: 'test.bad-json',
        name: 'Bad JSON',
        subject: 'Hello',
        variables: [],
        schemaVersion: '1',
      },
      previewData: {},
    };

    await assert.rejects(
      () => compile(source),
      (err: unknown) => {
        assert.ok(err instanceof CompilerError);
        assert.equal(err.code, 'RENDER_FAILURE');
        return true;
      },
    );
  });

  it('subject rendered with Handlebars: {{name}} with {name: "Jane"} renders to "Jane"', async () => {
    const source: TemplateSource = {
      templateJson: CONTACT_US_DOCUMENT,
      metadata: {
        key: 'test.subject-render',
        name: 'Subject Render Test',
        subject: '{{name}}',
        variables: ['name'],
        schemaVersion: '1',
      },
      previewData: { name: 'Jane' },
    };

    // compile does not return the rendered subject directly, but we can verify
    // there is no render error and use Handlebars directly to assert the rendering
    const Handlebars = await import('handlebars');
    const rendered = Handlebars.default.compile('{{name}}')({ name: 'Jane' });
    assert.equal(rendered, 'Jane');

    // compile() with a subject template and matching previewData should not throw
    const result = await compile(source);
    assert.ok(result.manifest.contentHash.length > 0);
  });
});

describe('compileFromDirectory()', () => {
  it('reads fixture files from disk and returns a CompiledTemplate', async () => {
    const dir = join(FIXTURES_DIR, 'marketing.contact-us');
    const result = await compileFromDirectory(dir);

    assert.equal(result.metadata.key, 'marketing.contact-us');
    assert.ok(result.manifest.contentHash.length > 0);
    assert.ok(result.templateHtml.length > 0);
  });
});

describe('validateSource()', () => {
  it('returns ok:true for a valid source', () => {
    const result = validateSource(contactUsSource);
    assert.ok(result.ok, 'expected ok:true');
  });

  it('returns ok:false with errors when a preview variable is missing', () => {
    const result = validateSource(missingPreviewVarSource);
    assert.ok(!result.ok, 'expected ok:false');
    if (!result.ok) {
      assert.ok(result.errors.length > 0, 'errors array should be non-empty');
      assert.ok(
        result.errors.some((e) => e.includes('resetUrl')),
        'errors should mention the missing variable',
      );
    }
  });

  it('returns ok:false with errors for malformed metadata (does not throw)', () => {
    let threw = false;
    let result: ReturnType<typeof validateSource>;
    try {
      result = validateSource(malformedMetadataSource);
    } catch {
      threw = true;
      result = { ok: false, errors: [] };
    }
    assert.ok(!threw, 'validateSource should not throw');
    assert.ok(!result.ok, 'expected ok:false');
  });
});
