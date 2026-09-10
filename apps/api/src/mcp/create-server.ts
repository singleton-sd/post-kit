import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  PostKitErrorCode,
  type Principal,
  type TemplateVariables,
} from '@singleton-sd/post-kit-types';
import { z } from 'zod';
import {
  AuthError,
  requireScope,
  scopeForMcpTool,
  tenantContextFromPrincipal,
  type McpScopedToolName,
} from '../auth';
import type { Logger } from '../telemetry';
import { TemplateStoreError, type TemplateApplicationService } from '../templates';

/** Initial MCP tool set for iteration 1 — no send_email. */
export const POSTKIT_MCP_TOOL_NAMES = [
  'postkit.list_templates',
  'postkit.get_template',
  'postkit.get_template_schema',
  'postkit.validate_template',
  'postkit.preview_template',
] as const satisfies readonly McpScopedToolName[];

export type PostkitMcpToolName = (typeof POSTKIT_MCP_TOOL_NAMES)[number];

/** Safe template key — same allowlist as BlobTemplateStore / send. */
export function isSafeTemplateKey(templateKey: string): boolean {
  return (
    Boolean(templateKey) &&
    templateKey !== '.' &&
    templateKey !== '..' &&
    /^[a-zA-Z0-9._-]+$/.test(templateKey)
  );
}

const templateKeyField = z.string().min(1);
const variablesField = z.record(z.string());

export interface CreatePostkitMcpServerOptions {
  templates: TemplateApplicationService;
  /** Authenticated principal — tenant identity and scopes come from here only. */
  principal: Principal;
  logger: Logger;
  /** Optional clock for duration measurement in tests. */
  now?: () => number;
}

function toolTextResult(payload: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function mapStoreError(err: unknown): { code: PostKitErrorCode | string; error: string } {
  if (err instanceof AuthError) {
    return { code: err.code, error: err.message };
  }
  if (err instanceof TemplateStoreError) {
    return { code: err.code, error: err.message };
  }
  if (err instanceof Error) {
    // Do not return SDK/network detail (URLs, account names) to MCP clients.
    return { code: 'INTERNAL_ERROR', error: 'Internal error' };
  }
  return { code: 'INTERNAL_ERROR', error: 'Unexpected error' };
}

function rejectUnsafeKey(templateKey: string): CallToolResult | undefined {
  if (!isSafeTemplateKey(templateKey)) {
    return toolTextResult(
      {
        code: PostKitErrorCode.INVALID_TEMPLATE,
        error: 'templateKey contains unsafe path characters.',
      },
      true,
    );
  }
  return undefined;
}

/**
 * Build a fresh MCP server for one HTTP request (stateless).
 * Tools close over the authenticated principal — never accept tenantId from tool args.
 * Scope checks run centrally in runTool via {@link scopeForMcpTool}.
 */
export function createPostkitMcpServer(options: CreatePostkitMcpServerOptions): McpServer {
  const { templates, principal, logger } = options;
  const tenant = tenantContextFromPrincipal(principal);
  const now = options.now ?? (() => Date.now());

  const server = new McpServer({
    name: 'post-kit',
    version: '0.1.0',
  });

  // MCP SDK + Zod generic inference can hit TS2589 ("excessively deep"); bind
  // through a loosely typed seam so tool wiring stays maintainable.
  const registerTool = (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny> | undefined,
    handler: unknown,
  ): void => {
    if (schema) {
      (server.tool as (n: string, d: string, s: unknown, h: unknown) => void)(
        name,
        description,
        schema,
        handler,
      );
    } else {
      (server.tool as (n: string, d: string, h: unknown) => void)(name, description, handler);
    }
  };

  const runTool = async <T>(
    tool: PostkitMcpToolName,
    templateKey: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> => {
    const startMs = now();
    try {
      // Scope check inside try so AuthError emits mcp.tool.failed / auth_error
      // (outer tool handlers catch and return MCP error results without failing transport).
      requireScope(principal, scopeForMcpTool(tool));
      const result = await work();
      logger.info('mcp.tool.completed', {
        mcpMethod: 'tools/call',
        mcpTool: tool,
        tenantId: tenant.tenantId,
        environment: tenant.environment,
        principalId: principal.id,
        templateKey,
        outcome: 'success',
        durationMs: now() - startMs,
      });
      return result;
    } catch (err) {
      const mapped = mapStoreError(err);
      logger.error('mcp.tool.failed', {
        mcpMethod: 'tools/call',
        mcpTool: tool,
        tenantId: tenant.tenantId,
        environment: tenant.environment,
        principalId: principal.id,
        templateKey,
        outcome: err instanceof AuthError ? 'auth_error' : 'failed',
        errorCode: mapped.code,
        durationMs: now() - startMs,
      });
      throw err;
    }
  };

  registerTool(
    'postkit.list_templates',
    'List compiled email templates available for the authenticated tenant and environment.',
    undefined,
    async () => {
      try {
        const items = await runTool('postkit.list_templates', undefined, () =>
          templates.listTemplates(tenant),
        );
        return toolTextResult({ templates: items });
      } catch (err) {
        return toolTextResult(mapStoreError(err), true);
      }
    },
  );

  registerTool(
    'postkit.get_template',
    'Load a compiled template artifact (metadata + HTML) for the given template key.',
    { templateKey: templateKeyField },
    async (args: { templateKey: string }) => {
      const unsafe = rejectUnsafeKey(args.templateKey);
      if (unsafe) return unsafe;
      try {
        const compiled = await runTool('postkit.get_template', args.templateKey, () =>
          templates.getTemplate(tenant, args.templateKey),
        );
        return toolTextResult({
          key: compiled.metadata.key,
          name: compiled.metadata.name,
          subject: compiled.metadata.subject,
          description: compiled.metadata.description,
          variables: compiled.metadata.variables,
          schemaVersion: compiled.metadata.schemaVersion,
          templateHtml: compiled.templateHtml,
        });
      } catch (err) {
        return toolTextResult(mapStoreError(err), true);
      }
    },
  );

  registerTool(
    'postkit.get_template_schema',
    'Return the variable schema and metadata for a compiled template without the HTML body.',
    { templateKey: templateKeyField },
    async (args: { templateKey: string }) => {
      const unsafe = rejectUnsafeKey(args.templateKey);
      if (unsafe) return unsafe;
      try {
        const schema = await runTool('postkit.get_template_schema', args.templateKey, () =>
          templates.getTemplateSchema(tenant, args.templateKey),
        );
        return toolTextResult(schema);
      } catch (err) {
        return toolTextResult(mapStoreError(err), true);
      }
    },
  );

  registerTool(
    'postkit.validate_template',
    'Check that provided variables satisfy the template required-variable set (same rules as send).',
    {
      templateKey: templateKeyField,
      variables: variablesField,
    },
    async (args: { templateKey: string; variables: TemplateVariables }) => {
      const unsafe = rejectUnsafeKey(args.templateKey);
      if (unsafe) return unsafe;
      try {
        const result = await runTool('postkit.validate_template', args.templateKey, () =>
          templates.validateTemplate(tenant, args.templateKey, args.variables),
        );
        if (!result.ok) {
          return toolTextResult(
            { ok: false, code: result.code, error: result.error, missing: result.missing },
            true,
          );
        }
        return toolTextResult({
          ok: true,
          templateKey: result.templateKey,
          variables: result.variables,
        });
      } catch (err) {
        return toolTextResult(mapStoreError(err), true);
      }
    },
  );

  registerTool(
    'postkit.preview_template',
    'Render subject and HTML with the given variables (Handlebars). Does not send email.',
    {
      templateKey: templateKeyField,
      variables: variablesField,
    },
    async (args: { templateKey: string; variables: TemplateVariables }) => {
      const unsafe = rejectUnsafeKey(args.templateKey);
      if (unsafe) return unsafe;
      try {
        const result = await runTool('postkit.preview_template', args.templateKey, () =>
          templates.previewTemplate(tenant, args.templateKey, args.variables),
        );
        if (!result.ok) {
          return toolTextResult(
            {
              ok: false,
              code: result.code,
              error: result.error,
              missing: result.missing,
            },
            true,
          );
        }
        return toolTextResult({
          ok: true,
          templateKey: result.templateKey,
          subject: result.subject,
          html: result.html,
        });
      } catch (err) {
        return toolTextResult(mapStoreError(err), true);
      }
    },
  );

  return server;
}
