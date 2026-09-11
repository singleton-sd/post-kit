/**
 * Filesystem list/load/save for Git-backed template sources.
 *
 * Server-side / Node only — never import from a browser bundle. Real hosts
 * expose these operations behind trusted admin APIs (then open a PR / write
 * to `content/email-templates/<dir>/`).
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
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

export interface FsTemplateStoreOptions {
  /** Injectable for tests (e.g. fail a later write). Defaults to `fs.writeFileSync`. */
  writeFileSync?: typeof writeFileSync;
}

/**
 * Create a store rooted at `templatesRoot` (absolute or relative to cwd).
 * Default layout: `<root>/<directory>/{template,metadata,preview}.json`.
 *
 * `save` stages all three files in a temp directory, then swaps that directory
 * into place so a mid-write failure cannot leave a mixed old/new triple.
 */
export function createFsTemplateStore(
  templatesRoot: string,
  options: FsTemplateStoreOptions = {},
): TemplateStore {
  const writeFile = options.writeFileSync ?? writeFileSync;

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
        if (dir.startsWith('.')) continue;
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
      try {
        assertSafeDirectory(directory);
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Invalid template directory name.',
        };
      }

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

      mkdirSync(templatesRoot, { recursive: true });
      const dirPath = join(templatesRoot, directory);
      const stagingPath = mkdtempSync(join(templatesRoot, `.${directory}-staging-`));
      const backupPath = join(templatesRoot, `.${directory}-backup-${process.pid}-${Date.now()}`);

      try {
        writeFile(
          join(stagingPath, 'template.json'),
          `${serialized.templateJson.trimEnd()}\n`,
          'utf8',
        );
        writeFile(
          join(stagingPath, 'metadata.json'),
          `${serialized.metadataJson.trimEnd()}\n`,
          'utf8',
        );
        writeFile(
          join(stagingPath, 'preview.json'),
          `${serialized.previewJson.trimEnd()}\n`,
          'utf8',
        );

        if (existsSync(dirPath)) {
          renameSync(dirPath, backupPath);
        }
        renameSync(stagingPath, dirPath);
        if (existsSync(backupPath)) {
          rmSync(backupPath, { recursive: true, force: true });
        }
        return { ok: true };
      } catch (err) {
        rmSync(stagingPath, { recursive: true, force: true });
        if (existsSync(backupPath) && !existsSync(dirPath)) {
          try {
            renameSync(backupPath, dirPath);
          } catch {
            // leave backup in place for manual recovery
          }
        } else if (existsSync(backupPath)) {
          rmSync(backupPath, { recursive: true, force: true });
        }
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Failed to save template files.',
        };
      }
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
