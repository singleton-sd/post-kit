import Handlebars from 'handlebars';
import type {
  CompiledTemplate,
  TenantBranding,
  TemplateVariables,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';

/**
 * Shared template variable merge + required-variable check + Handlebars render.
 * Used by REST send and MCP preview/validate so both adapters share one path.
 */

export type VariableValidationResult =
  | { ok: true; variables: TemplateVariables }
  | { ok: false; code: PostKitErrorCode; error: string; missing: string[] };

/**
 * Merge branding defaults with caller-supplied variables.
 * Caller values win over branding.
 */
export function mergeTemplateVariables(
  branding: TenantBranding | undefined,
  variables: TemplateVariables,
): TemplateVariables {
  return {
    ...(branding ?? {}),
    ...variables,
  };
}

/**
 * Ensure every name in `compiled.metadata.variables` is an own property of
 * `variables`. Does not inspect variable values beyond presence.
 */
export function validateRequiredVariables(
  compiled: CompiledTemplate,
  variables: TemplateVariables,
): VariableValidationResult {
  const missing = compiled.metadata.variables.filter(
    (name) => !Object.prototype.hasOwnProperty.call(variables, name),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: PostKitErrorCode.MISSING_VARIABLES,
      error: `Missing required variables: ${missing.join(', ')}`,
      missing,
    };
  }
  return { ok: true, variables };
}

export interface RenderedTemplate {
  subject: string;
  html: string;
}

/**
 * Render subject + HTML with Handlebars (HTML escaping on — same as send).
 */
export function renderCompiledTemplate(
  compiled: CompiledTemplate,
  variables: TemplateVariables,
): RenderedTemplate {
  const subject = Handlebars.compile(compiled.metadata.subject, { noEscape: false })(variables);
  const html = Handlebars.compile(compiled.templateHtml, { noEscape: false })(variables);
  return { subject, html };
}

/**
 * Validate required variables then render. Returns validation failure without
 * throwing when variables are incomplete.
 */
export function validateAndRenderTemplate(
  compiled: CompiledTemplate,
  branding: TenantBranding | undefined,
  variables: TemplateVariables,
):
  | { ok: true; rendered: RenderedTemplate; variables: TemplateVariables }
  | { ok: false; code: PostKitErrorCode; error: string; missing: string[] } {
  const merged = mergeTemplateVariables(branding, variables);
  const validation = validateRequiredVariables(compiled, merged);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    rendered: renderCompiledTemplate(compiled, validation.variables),
    variables: validation.variables,
  };
}
