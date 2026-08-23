/**
 * Tenant contracts.
 *
 * These types describe the runtime tenant context resolved by apps/api from
 * an authenticated credential, and the optional branding defaults that are
 * merged into template variables before rendering.
 *
 * Tenant identity is always server-side — it must never be accepted directly
 * from a request payload.
 */

/**
 * The deployment environment for a tenant context.
 * Used to isolate template storage paths and configuration.
 */
export type TenantEnvironment = 'development' | 'staging' | 'production';

/**
 * The resolved, authoritative tenant identity for a single API request.
 * Produced by TenantResolver in apps/api; never sourced from request body.
 */
export interface TenantContext {
  /** Unique tenant identifier, e.g. `inkads`. */
  tenantId: string;
  /** Deployment environment for this credential. */
  environment: TenantEnvironment;
}

/**
 * Tenant-level branding defaults merged into template variables before rendering.
 * Stored in the tenant's blob storage path alongside compiled templates.
 *
 * All fields are optional — templates that do not reference branding variables
 * are unaffected.
 *
 * @example
 * {
 *   companyName: 'InkAds',
 *   logoUrl: 'https://cdn.inkads.com/logo.svg',
 *   websiteUrl: 'https://inkads.com',
 *   supportEmail: 'hello@inkads.com',
 * }
 */
export interface TenantBranding {
  /** Display name of the tenant company or brand. */
  companyName?: string;
  /** URL of the tenant's logo image. */
  logoUrl?: string;
  /** URL of the tenant's primary website. */
  websiteUrl?: string;
  /** Tenant support email address. */
  supportEmail?: string;
}

/**
 * The resolved variable map passed to the template renderer.
 * Combines request-supplied variables with tenant branding defaults.
 * All values are strings — the template engine handles escaping.
 */
export type TemplateVariables = Record<string, string>;
