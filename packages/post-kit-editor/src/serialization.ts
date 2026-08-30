import { TEMPLATE_SCHEMA_VERSION } from '@singleton-sd/post-kit-types';
import type { TemplatePreviewData, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';
import type { EmailBuilderDocument, TemplateSourceFiles } from './types';

export class TemplateSourceError extends Error {
  readonly file: 'template.json' | 'metadata.json' | 'preview.json';

  constructor(file: TemplateSourceError['file'], message: string) {
    super(`${file}: ${message}`);
    this.name = 'TemplateSourceError';
    this.file = file;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTemplateJson(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TemplateSourceError('template.json', 'must be a JSON object');
  }

  if (!('root' in value)) {
    throw new TemplateSourceError(
      'template.json',
      'must be an EmailBuilder document object with a root block',
    );
  }

  return value;
}

function assertMetadata(value: unknown): TemplateSourceMetadata {
  if (!isPlainObject(value)) {
    throw new TemplateSourceError('metadata.json', 'must be a JSON object');
  }

  const requiredStrings = ['key', 'name', 'subject', 'schemaVersion'] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw new TemplateSourceError(
        'metadata.json',
        `metadata.${field} must be a non-empty string`,
      );
    }
  }

  if (value.schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    throw new TemplateSourceError(
      'metadata.json',
      `metadata.schemaVersion must be "${TEMPLATE_SCHEMA_VERSION}" (got ${JSON.stringify(value.schemaVersion)})`,
    );
  }

  if (!Array.isArray(value.variables)) {
    throw new TemplateSourceError('metadata.json', 'metadata.variables must be an array');
  }

  for (let i = 0; i < value.variables.length; i++) {
    if (typeof value.variables[i] !== 'string') {
      throw new TemplateSourceError('metadata.json', `metadata.variables[${i}] must be a string`);
    }
  }

  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new TemplateSourceError('metadata.json', 'metadata.description must be a string');
  }

  return value as unknown as TemplateSourceMetadata;
}

function assertPreviewData(value: unknown): TemplatePreviewData {
  if (!isPlainObject(value)) {
    throw new TemplateSourceError('preview.json', 'must be a JSON object');
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new TemplateSourceError('preview.json', `preview.${key} must be a string`);
    }
  }

  return value as TemplatePreviewData;
}

function sortKeys(value: unknown, preferredOrder: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry, preferredOrder));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const preferred = preferredOrder.filter((key) => key in value);
  const remaining = Object.keys(value)
    .filter((key) => !preferred.includes(key))
    .sort();
  const orderedKeys = [...preferred, ...remaining];

  const sorted: Record<string, unknown> = {};
  for (const key of orderedKeys) {
    sorted[key] = sortKeys(value[key], preferredOrder);
  }
  return sorted;
}

function stableTemplateJson(value: Record<string, unknown>): string {
  const ordered = sortKeys(value, ['root']) as Record<string, unknown>;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function stableMetadataJson(value: TemplateSourceMetadata): string {
  const ordered = sortKeys(value, [
    'key',
    'name',
    'subject',
    'description',
    'variables',
    'schemaVersion',
  ]) as TemplateSourceMetadata;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function stablePreviewJson(value: TemplatePreviewData): string {
  const ordered = sortKeys(value) as TemplatePreviewData;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function loadTemplateSource(input: {
  templateJson: unknown;
  metadata: unknown;
  previewData: unknown;
}): TemplateSourceFiles {
  const templateJson = assertTemplateJson(input.templateJson);
  const metadata = assertMetadata(input.metadata);
  const previewData = assertPreviewData(input.previewData);

  return {
    templateJson: templateJson as EmailBuilderDocument,
    metadata,
    previewData,
  };
}

export function serializeTemplateSource(files: TemplateSourceFiles): {
  templateJson: string;
  metadataJson: string;
  previewJson: string;
} {
  if (!isPlainObject(files.templateJson)) {
    throw new TemplateSourceError('template.json', 'must be a JSON object');
  }

  return {
    templateJson: stableTemplateJson(files.templateJson),
    metadataJson: stableMetadataJson(files.metadata),
    previewJson: stablePreviewJson(files.previewData),
  };
}
