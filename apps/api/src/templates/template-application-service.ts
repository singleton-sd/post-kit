import type {
  CompiledTemplate,
  TenantBranding,
  TenantContext,
  TemplateVariables,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import {
  mergeTemplateVariables,
  validateAndRenderTemplate,
  validateRequiredVariables,
  type RenderedTemplate,
} from './render-template';
import type { TemplateListItem, TemplateStore } from './template-store';

export type TemplateSchema = {
  key: string;
  name: string;
  subject: string;
  description?: string;
  variables: string[];
  schemaVersion: string;
  /** JSON Schema draft-ish shape for the variables object. */
  variablesSchema: {
    type: 'object';
    required: string[];
    properties: Record<string, { type: 'string' }>;
    additionalProperties: { type: 'string' };
  };
};

export type TemplateValidateResult =
  | { ok: true; templateKey: string; variables: string[] }
  | { ok: false; code: PostKitErrorCode; error: string; missing: string[] };

export type TemplatePreviewResult =
  | { ok: true; templateKey: string; subject: string; html: string }
  | { ok: false; code: PostKitErrorCode; error: string; missing?: string[] };

export interface TemplateApplicationServiceOptions {
  templateStore: TemplateStore;
  resolveBranding?: (tenant: TenantContext) => Promise<TenantBranding> | TenantBranding;
}

/**
 * Application-layer template operations shared by REST and MCP adapters.
 * Handlers must not re-implement load / validate / render logic.
 */
export class TemplateApplicationService {
  private readonly templateStore: TemplateStore;
  private readonly resolveBranding?: (
    tenant: TenantContext,
  ) => Promise<TenantBranding> | TenantBranding;

  constructor(options: TemplateApplicationServiceOptions) {
    this.templateStore = options.templateStore;
    this.resolveBranding = options.resolveBranding;
  }

  async listTemplates(tenant: TenantContext): Promise<TemplateListItem[]> {
    return this.templateStore.list(tenant);
  }

  async getTemplate(tenant: TenantContext, templateKey: string): Promise<CompiledTemplate> {
    return this.templateStore.load(tenant, templateKey);
  }

  async getTemplateSchema(tenant: TenantContext, templateKey: string): Promise<TemplateSchema> {
    const compiled = await this.templateStore.load(tenant, templateKey);
    return toTemplateSchema(compiled);
  }

  async validateTemplate(
    tenant: TenantContext,
    templateKey: string,
    variables: TemplateVariables,
  ): Promise<TemplateValidateResult> {
    const compiled = await this.templateStore.load(tenant, templateKey);
    const branding = this.resolveBranding ? await this.resolveBranding(tenant) : {};
    const merged = mergeTemplateVariables(branding, variables);
    const validation = validateRequiredVariables(compiled, merged);
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        error: validation.error,
        missing: validation.missing,
      };
    }
    return {
      ok: true,
      templateKey: compiled.metadata.key,
      variables: compiled.metadata.variables,
    };
  }

  async previewTemplate(
    tenant: TenantContext,
    templateKey: string,
    variables: TemplateVariables,
  ): Promise<TemplatePreviewResult> {
    const compiled = await this.templateStore.load(tenant, templateKey);
    const branding = this.resolveBranding ? await this.resolveBranding(tenant) : {};
    const result = validateAndRenderTemplate(compiled, branding, variables);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        error: result.error,
        missing: result.missing,
      };
    }
    return {
      ok: true,
      templateKey: compiled.metadata.key,
      subject: result.rendered.subject,
      html: result.rendered.html,
    };
  }
}

export function toTemplateSchema(compiled: CompiledTemplate): TemplateSchema {
  const { metadata } = compiled;
  const properties: Record<string, { type: 'string' }> = {};
  for (const name of metadata.variables) {
    properties[name] = { type: 'string' };
  }
  return {
    key: metadata.key,
    name: metadata.name,
    subject: metadata.subject,
    description: metadata.description,
    variables: metadata.variables,
    schemaVersion: metadata.schemaVersion,
    variablesSchema: {
      type: 'object',
      required: [...metadata.variables],
      properties,
      additionalProperties: { type: 'string' },
    },
  };
}

/** Narrow helper for callers that already have a rendered preview. */
export type { RenderedTemplate };
