/**
 * Filesystem list/load/save for Git-backed template sources.
 *
 * Server-side / Node only — never import from a browser bundle. Real hosts
 * expose these operations behind trusted admin APIs (then open a PR / write
 * to `content/email-templates/<dir>/`).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadTemplateSource,
  type SerializedTemplateSource,
  type TemplateSourceFiles,
  type SaveResult,
} from '@singleton-sd/post-kit-editor';

const SOURCE_FILES = ['template.json', 'metadata.json', 'preview.json'] as const;

export interface TemplateListItem {
  /** Directory name under the templates root (usually equals metadata.key). */
  directory: string;
  key: string;
  name: string;
}

export interface TemplateStore {
  list(): TemplateListItem[];
  load(directory: string): TemplateSourceFiles;
  save(
    directory: string,
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
  ): SaveResult;
}

/**
 * Create a store rooted at `templatesRoot` (absolute or relative to cwd).
 * Default layout: `<root>/<directory>/{template,metadata,preview}.json`.
 */
export function createFsTemplateStore(templatesRoot: string): TemplateStore {
  return {
    list(): TemplateListItem[] {
      if (!existsSync(templatesRoot)) {
        return [];
      }
      const entries = readdirSync(templatesRoot, { withFileTypes: true });
      const items: TemplateListItem[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = entry.name;
        try {
          const files = loadDirectory(templatesRoot, dir);
          items.push({
            directory: dir,
            key: files.metadata.key,
            name: files.metadata.name,
          });
        } catch {
          // Skip incomplete / invalid directories — real hosts should log.
        }
      }
      return items.sort((a, b) => a.key.localeCompare(b.key));
    },

    load(directory: string): TemplateSourceFiles {
      assertSafeDirectory(directory);
      return loadDirectory(templatesRoot, directory);
    },

    save(directory, serialized, files): SaveResult {
      assertSafeDirectory(directory);
      if (files.metadata.key.length === 0) {
        return { ok: false, message: 'metadata.key is required.' };
      }

      let fromSerialized: TemplateSourceFiles;
      try {
        fromSerialized = loadTemplateSource({
          templateJson: JSON.parse(serialized.templateJson) as unknown,
          metadata: JSON.parse(serialized.metadataJson) as unknown,
          previewData: JSON.parse(serialized.previewJson) as unknown,
        });
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Invalid serialized template.',
        };
      }

      if (fromSerialized.metadata.key !== files.metadata.key) {
        return { ok: false, message: 'Serialized key does not match files.metadata.key.' };
      }

      const dirPath = join(templatesRoot, directory);
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(
        join(dirPath, 'template.json'),
        `${serialized.templateJson.trimEnd()}\n`,
        'utf8',
      );
      writeFileSync(
        join(dirPath, 'metadata.json'),
        `${serialized.metadataJson.trimEnd()}\n`,
        'utf8',
      );
      writeFileSync(join(dirPath, 'preview.json'), `${serialized.previewJson.trimEnd()}\n`, 'utf8');
      return { ok: true };
    },
  };
}

function loadDirectory(root: string, directory: string): TemplateSourceFiles {
  const dirPath = join(root, directory);
  for (const name of SOURCE_FILES) {
    if (!existsSync(join(dirPath, name))) {
      throw new Error(`Missing ${name} in ${directory}`);
    }
  }
  return loadTemplateSource({
    templateJson: JSON.parse(readFileSync(join(dirPath, 'template.json'), 'utf8')) as unknown,
    metadata: JSON.parse(readFileSync(join(dirPath, 'metadata.json'), 'utf8')) as unknown,
    previewData: JSON.parse(readFileSync(join(dirPath, 'preview.json'), 'utf8')) as unknown,
  });
}

/** Reject path traversal — directory must be a single path segment. */
export function assertSafeDirectory(directory: string): void {
  if (
    !directory ||
    directory === '.' ||
    directory === '..' ||
    directory.includes('/') ||
    directory.includes('\\') ||
    directory.includes('\0')
  ) {
    throw new Error('Invalid template directory name.');
  }
}
