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
  /**
   * Persist from an `onSave` payload. Returns a {@link SaveResult} so the
   * editor can keep dirty state on failure.
   */
  save(
    serialized: SerializedTemplateSource,
    files: TemplateSourceFiles,
  ): Promise<SaveResult | void> | SaveResult | void;
}

export interface MemoryPersistenceOptions {
  /** When true, every `save` returns `{ ok: false, message }` without writing. */
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
