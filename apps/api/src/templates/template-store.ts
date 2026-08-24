import type { CompiledTemplate, TenantContext } from '@singleton-sd/post-kit-types';

/**
 * Abstraction over compiled template artifact storage.
 * Implementations load compiled template artifacts (HTML + metadata)
 * for a given tenant context and template key.
 */
export interface TemplateStore {
  /**
   * Load a compiled template artifact for the given tenant and template key.
   *
   * @param tenant   - The resolved tenant context (tenantId + environment).
   * @param templateKey - The template key, e.g. `marketing.contact-us`.
   * @returns The compiled template with HTML, metadata, and manifest.
   * @throws {TemplateStoreError} with code TEMPLATE_NOT_FOUND if no artifact exists.
   * @throws {TemplateStoreError} with code INVALID_TEMPLATE if the artifact is corrupt.
   */
  load(tenant: TenantContext, templateKey: string): Promise<CompiledTemplate>;
}
