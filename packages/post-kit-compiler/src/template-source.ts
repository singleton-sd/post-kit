import type { TemplateSourceMetadata, TemplatePreviewData } from '@singleton-sd/post-kit-types';

export interface TemplateSource {
  templateJson: unknown; // EmailBuilder.js document (any valid JSON)
  metadata: TemplateSourceMetadata;
  previewData: TemplatePreviewData;
}
