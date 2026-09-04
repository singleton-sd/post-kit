import type { TemplateSourceMetadata } from '@singleton-sd/post-kit-types';

import type { EmailBuilderDocument, TemplateSourceFiles } from './types';

/** Replace working metadata; document and preview data are left unchanged. */
export function withMetadata(
  files: TemplateSourceFiles,
  metadata: TemplateSourceMetadata,
): TemplateSourceFiles {
  return { ...files, metadata };
}

/**
 * Replace declared `metadata.variables` only.
 * Does not rewrite the EmailBuilder document or subject.
 */
export function withMetadataVariables(
  files: TemplateSourceFiles,
  variables: string[],
): TemplateSourceFiles {
  return {
    ...files,
    metadata: {
      ...files.metadata,
      variables,
    },
  };
}

/** Replace the EmailBuilder document; metadata is left unchanged. */
export function withDocument(
  files: TemplateSourceFiles,
  templateJson: EmailBuilderDocument,
): TemplateSourceFiles {
  return { ...files, templateJson };
}
