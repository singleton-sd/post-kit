import type {
  SerializedTemplateSource,
  TemplateSourceFiles,
  SaveResult,
} from '@singleton-sd/post-kit-editor';
import { loadTemplateSource, serializeTemplateSource } from '@singleton-sd/post-kit-editor';

/**
 * Consumer-owned persistence shaped around the editor's real callbacks.
 *
 * The package does not export a PersistenceAdapter interface — hosts implement
 * load (before mount) and save (inside `onSave`) however they like. This
 * in-memory store is for the example and its contract tests only.
 */
export interface MemoryPersistence {
  /** Return the stored triple for `key`, or throw if missing. */
  load(key: string): TemplateSourceFiles;
  /** True when `key` is present in the in-memory map. */
  has(key: string): boolean;
  /** Keys currently held (including unsaved edits). */
  keys(): string[];
  /**
   * Merge a parent catalog into the store without clobbering in-memory edits.
   * Adds missing keys; drops keys absent from the catalog.
   */
  syncCatalog(templates: TemplateSourceFiles[]): void;
  /**
   * Persist from an `onSave` payload. Returns a {@link SaveResult} so the
   * editor can keep dirty state on failure.
   */
  save(
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
  ): Promise<SaveResult | void> | SaveResult | void;
}

/**
 * Keep selection on a key that still exists in the catalog.
 * Returns `catalogKeys[0]` when the current selection was removed.
 */
export function reconcileSelectedKey(selectedKey: string, catalogKeys: string[]): string {
  if (catalogKeys.length === 0) {
    throw new Error('Catalog must contain at least one template key.');
  }
  return catalogKeys.includes(selectedKey) ? selectedKey : catalogKeys[0]!;
}

export interface MemoryPersistenceOptions {
  /** When true, the next `save` returns `{ ok: false, message }` without writing. */
  failNextSave?: boolean;
}

export function createMemoryPersistence(
  initial: Record<string, TemplateSourceFiles> = {},
  options: MemoryPersistenceOptions = {},
): MemoryPersistence {
  const store = new Map<string, TemplateSourceFiles>();
  for (const [key, files] of Object.entries(initial)) {
    store.set(key, structuredClone(files));
  }

  let failNextSave = options.failNextSave === true;

  return {
    load(key: string): TemplateSourceFiles {
      const found = store.get(key);
      if (!found) {
        throw new Error(`Template not found: ${key}`);
      }
      return structuredClone(found);
    },

    has(key: string): boolean {
      return store.has(key);
    },

    keys(): string[] {
      return [...store.keys()];
    },

    syncCatalog(templates: TemplateSourceFiles[]): void {
      const nextKeys = new Set(templates.map((t) => t.metadata.key));
      for (const key of store.keys()) {
        if (!nextKeys.has(key)) {
          store.delete(key);
        }
      }
      for (const files of templates) {
        if (!store.has(files.metadata.key)) {
          store.set(files.metadata.key, structuredClone(files));
        }
      }
    },

    save(serialized, files): SaveResult {
      if (failNextSave) {
        failNextSave = false;
        return { ok: false, message: 'Simulated save failure.' };
      }

      // Prefer structured files; re-parse serialized strings to prove the
      // Git payload round-trips through loadTemplateSource.
      const fromSerialized = loadTemplateSource({
        templateJson: JSON.parse(serialized.templateJson) as unknown,
        metadata: JSON.parse(serialized.metadataJson) as unknown,
        previewData: JSON.parse(serialized.previewJson) as unknown,
      });

      if (fromSerialized.metadata.key !== files.metadata.key) {
        return { ok: false, message: 'Serialized key does not match files.metadata.key.' };
      }

      // Ensure serialize → parse is stable for the structured side too.
      void serializeTemplateSource(files);

      store.set(files.metadata.key, structuredClone(fromSerialized));
      return { ok: true };
    },
  };
}

/** Wire `persistence.save` directly as `EmailTemplateEditor` `onSave`. */
export function toOnSave(
  persistence: MemoryPersistence,
): (
  serialized: SerializedTemplateSource,
  files: TemplateSourceFiles,
) => Promise<SaveResult | void> | SaveResult | void {
  return (serialized, files) => persistence.save(serialized, files);
}

/** Map prop catalog to in-memory copies (including prior successful saves). */
export function buildWorkingCatalog(
  templates: TemplateSourceFiles[],
  persistence: MemoryPersistence,
): TemplateSourceFiles[] {
  return templates.map((t) =>
    persistence.has(t.metadata.key) ? persistence.load(t.metadata.key) : t,
  );
}

/**
 * Like {@link toOnSave}, but invokes `onRefresh` after a successful write so
 * React hosts can recompute {@link buildWorkingCatalog}.
 */
export function toOnSaveWithRefresh(
  persistence: MemoryPersistence,
  onRefresh: () => void,
): (
  serialized: SerializedTemplateSource,
  files: TemplateSourceFiles,
) => Promise<SaveResult | void> | SaveResult | void {
  return async (serialized, files) => {
    const result = await Promise.resolve(persistence.save(serialized, files));
    const failed = result && typeof result === 'object' && 'ok' in result && result.ok === false;
    if (!failed) {
      onRefresh();
    }
    return result;
  };
}
