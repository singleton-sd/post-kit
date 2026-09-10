import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompiledTemplate, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import { CompilerError } from './compiler-error';
import { compileTemplateCore } from './render-preview';
import type { TemplateSource } from './template-source';

export { renderPreview, validateSource } from './render-preview';

/**
 * Compile a {@link TemplateSource} into a {@link CompiledTemplate}.
 *
 * Validation steps (in order):
 *  1. Metadata shape check — all required string fields present and non-empty.
 *  2. Preview-variable coverage — every variable listed in metadata must have
 *     a corresponding key in previewData.
 *  3. HTML render via `@usewaypoint/email-builder`.
 *  4. Handlebars subject and preview-variable render (validation only).
 *  5. SHA-256 content hash of the rendered HTML (compiledAt excluded).
 *
 * Stored `templateHtml` keeps `{{variable}}` placeholders for send time.
 * For a fully substituted preview string, use {@link renderPreview} from
 * `@singleton-sd/post-kit-compiler/preview` (browser-safe) or this package root.
 *
 * Node-only: uses `node:crypto` for content hashing.
 */
export async function compile(
  source: TemplateSource,
  options?: { sourceCommit?: string },
): Promise<CompiledTemplate> {
  const { metadata, templateHtml } = compileTemplateCore(source);

  const contentHash = createHash('sha256').update(templateHtml).digest('hex');

  const compiledAt = new Date().toISOString();

  return {
    templateHtml,
    metadata,
    manifest: {
      key: metadata.key,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      compiledAt,
      sourceCommit: options?.sourceCommit ?? '',
      variables: metadata.variables,
      contentHash,
    },
  };
}

/**
 * Read `template.json`, `metadata.json`, and `preview.json` from `dir` and
 * delegate to {@link compile}.
 *
 * Node-only: uses `node:fs` / `node:path`.
 */
export async function compileFromDirectory(
  dir: string,
  options?: { sourceCommit?: string },
): Promise<CompiledTemplate> {
  let templateJson: unknown;
  let metadataRaw: unknown;
  let previewData: unknown;

  try {
    const raw = await readFile(join(dir, 'template.json'), 'utf-8');
    templateJson = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_TEMPLATE_JSON',
      `Failed to read/parse template.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const raw = await readFile(join(dir, 'metadata.json'), 'utf-8');
    metadataRaw = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_METADATA',
      `Failed to read/parse metadata.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const raw = await readFile(join(dir, 'preview.json'), 'utf-8');
    previewData = JSON.parse(raw);
  } catch (err) {
    throw new CompilerError(
      'INVALID_METADATA',
      `Failed to read/parse preview.json in "${dir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return compile(
    {
      templateJson,
      metadata: metadataRaw as TemplateSourceMetadata,
      previewData: previewData as Record<string, string>,
    },
    options,
  );
}
