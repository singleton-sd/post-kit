/**
 * @singleton-sd/post-kit-types
 *
 * Shared TypeScript contracts for the PostKit platform.
 *
 * Consumers:
 *   - apps/api           — send endpoint, tenant resolver, template store
 *   - post-kit-compiler  — validates and compiles template source files
 *   - post-kit-publisher — publishes compiled artifacts to Azure Blob Storage
 *   - post-kit-client    — trusted server-side consumer SDK
 *   - post-kit-editor    — React admin editor component
 *
 * This package has no runtime dependencies. All exports are pure TypeScript
 * interfaces, type aliases, and enums.
 */

// Template source contracts (Git-backed source files)
export {
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TemplateManifest,
  type TemplatePreviewData,
  type TemplateSourceMetadata,
} from './template';

// API send contracts (HTTP request/response surface)
export {
  PostKitErrorCode,
  type PostKitErrorResponse,
  type SendRequest,
  type SendResponse,
} from './send';

// Tenant contracts (runtime identity and branding)
export {
  type TenantBranding,
  type TenantContext,
  type TenantEnvironment,
  type TemplateVariables,
} from './tenant';
