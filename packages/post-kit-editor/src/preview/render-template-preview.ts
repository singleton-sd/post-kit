import type { TemplateSource } from '@singleton-sd/post-kit-compiler/preview';
import { CompilerError, renderPreview } from '@singleton-sd/post-kit-compiler/preview';

import type { TemplateSourceFiles } from '../types';

export type PreviewRenderResult = { ok: true; html: string } | { ok: false; error: string };

/**
 * Compile + substitute preview HTML via `@singleton-sd/post-kit-compiler/preview`.
 * Never throws — failures become `{ ok: false, error }`.
 */
export async function renderTemplatePreview(
  files: TemplateSourceFiles,
): Promise<PreviewRenderResult> {
  const source: TemplateSource = {
    templateJson: files.templateJson,
    metadata: files.metadata,
    previewData: files.previewData,
  };

  try {
    const html = await renderPreview(source);
    return { ok: true, html };
  } catch (err) {
    if (err instanceof CompilerError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Default debounce for preview re-renders while the user types. */
export const PREVIEW_DEBOUNCE_MS = 300;
