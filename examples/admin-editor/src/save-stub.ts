/**
 * Wire a filesystem {@link TemplateStore} as `EmailTemplateEditor` `onSave`.
 *
 * Writes the three source files under `content/email-templates/<directory>/`.
 * Real hosts usually open a GitHub PR instead of writing the publish branch
 * directly — this stub prints that reminder after a successful write.
 */
import type {
  SerializedTemplateSource,
  TemplateSourceFiles,
  SaveResult,
} from '@singleton-sd/post-kit-editor';
import type { TemplateStore } from './template-store';

export function toFsOnSave(
  store: TemplateStore,
  directoryForKey: (key: string) => string,
  log: (message: string) => void = console.info,
): (serialized: SerializedTemplateSource, files: TemplateSourceFiles) => SaveResult {
  return (serialized, files) => {
    const directory = directoryForKey(files.metadata.key);
    const result = store.save(directory, serialized, files);
    if (result.ok) {
      log(
        `[post-kit admin-editor] Saved ${directory}/{template,metadata,preview}.json. ` +
          'In production, open a PR for these files and let CI run post-kit-publish.',
      );
    }
    return result;
  };
}
