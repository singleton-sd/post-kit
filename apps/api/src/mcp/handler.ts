import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  PostKitErrorCode,
  type TenantContext,
  type TenantEnvironment,
} from '@singleton-sd/post-kit-types';
import { ensureAppConfiguration } from '../config/app-configuration';
import { createLogger, resolveCorrelationId, type Logger } from '../telemetry';
import { ApiKeyTenantResolver, type TenantKeyMap, type TenantResolver } from '../tenant';
import { BlobTemplateStore, TemplateApplicationService, type TemplateStore } from '../templates';
import { TenantResolverError } from './auth';
import { createPostkitMcpServer } from './create-server';
import { azureHttpRequestToWebRequest, webResponseToAzureHttpResponse } from './http-bridge';

const TENANT_ENVIRONMENTS = new Set<TenantEnvironment>(['development', 'staging', 'production']);

const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Correlation-Id, mcp-session-id, mcp-protocol-version',
} as const;

export interface McpHandlerDependencies {
  tenantResolver: TenantResolver;
  templateStore: TemplateStore;
  resolveBranding?: (
    tenant: TenantContext,
  ) => Promise<Record<string, string>> | Record<string, string>;
  createLogger?: typeof createLogger;
}

/** Sanitize-parse TENANT_KEY_MAP. Never logs raw contents or credentials. */
export function parseTenantKeyMap(
  raw: string | undefined,
  log: Logger = createLogger('config'),
): TenantKeyMap {
  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_JSON',
    });
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log.error('tenant_key_map.invalid', {
      outcome: 'failed',
      failureCategory: 'configuration',
      errorCode: 'TENANT_KEY_MAP_INVALID_SHAPE',
    });
    return {};
  }

  const result: TenantKeyMap = {};
  for (const [token, entry] of Object.entries(parsed)) {
    if (!isTenantKeyMapEntry(entry)) {
      log.error('tenant_key_map.invalid', {
        outcome: 'failed',
        failureCategory: 'configuration',
        errorCode: 'TENANT_KEY_MAP_INVALID_ENTRY',
      });
      return {};
    }
    result[token] = entry;
  }
  return result;
}

function isTenantKeyMapEntry(
  value: unknown,
): value is { tenantId: string; environment: TenantEnvironment } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['tenantId'] === 'string' &&
    obj['tenantId'].length > 0 &&
    typeof obj['environment'] === 'string' &&
    TENANT_ENVIRONMENTS.has(obj['environment'] as TenantEnvironment)
  );
}

export function createDefaultMcpDependencies(templateStore: TemplateStore): McpHandlerDependencies {
  return {
    get tenantResolver(): TenantResolver {
      return new ApiKeyTenantResolver(parseTenantKeyMap(process.env.TENANT_KEY_MAP));
    },
    templateStore,
    resolveBranding: async () => ({}),
  };
}

function jsonError(
  status: number,
  code: PostKitErrorCode,
  error: string,
  correlationId: string,
  headers: Record<string, string>,
): HttpResponseInit {
  return {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
    jsonBody: { error, code, correlationId },
  };
}

/**
 * Azure Functions HTTP handler for the stateless MCP Streamable HTTP endpoint.
 */
export function createMcpHandler(deps: McpHandlerDependencies) {
  return async function mcpHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const startMs = Date.now();
    const correlationId = resolveCorrelationId(
      request.headers.get('x-correlation-id') ?? undefined,
    );
    const logger: Logger = (deps.createLogger ?? createLogger)(correlationId);
    const headers: Record<string, string> = {
      'X-Correlation-Id': correlationId,
      ...MCP_CORS_HEADERS,
    };

    logger.info('mcp.request.received', {
      httpMethod: request.method,
    });

    if (request.method === 'GET' || request.method === 'DELETE') {
      logger.info('mcp.request.rejected', {
        outcome: 'failed',
        failureCategory: 'method_not_allowed',
        durationMs: Date.now() - startMs,
      });
      return {
        status: 405,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Allow: 'POST, OPTIONS',
        },
        jsonBody: {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        },
      };
    }

    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Correlation-Id, mcp-session-id, mcp-protocol-version, Last-Event-ID',
        },
      };
    }

    try {
      await ensureAppConfiguration();
    } catch (error) {
      context.error('app configuration load failed', {
        name: error instanceof Error ? error.name : 'Error',
      });
      return jsonError(
        503,
        PostKitErrorCode.STORAGE_FAILURE,
        'Service configuration is temporarily unavailable.',
        correlationId,
        headers,
      );
    }

    let tenant: TenantContext;
    try {
      tenant = await deps.tenantResolver.resolve(request);
    } catch (err) {
      if (err instanceof TenantResolverError) {
        const status = err.code === PostKitErrorCode.UNAUTHENTICATED ? 401 : 403;
        logger.error('mcp.request.failed', {
          outcome: 'auth_error',
          errorCode: err.code,
          durationMs: Date.now() - startMs,
        });
        return jsonError(status, err.code, err.message, correlationId, headers);
      }
      throw err;
    }

    const templates = new TemplateApplicationService({
      templateStore: deps.templateStore,
      resolveBranding: deps.resolveBranding,
    });

    const server = createPostkitMcpServer({
      templates,
      tenant,
      logger,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      const webRequest = await azureHttpRequestToWebRequest(request);
      const webResponse = await transport.handleRequest(webRequest);
      const azureResponse = await webResponseToAzureHttpResponse(webResponse);

      const responseHeaders = {
        ...headers,
        ...(azureResponse.headers ?? {}),
      };

      logger.info('mcp.request.completed', {
        tenantId: tenant.tenantId,
        environment: tenant.environment,
        outcome: 'success',
        durationMs: Date.now() - startMs,
      });

      return {
        ...azureResponse,
        headers: responseHeaders,
      };
    } catch (error) {
      context.error('mcp request failed', {
        name: error instanceof Error ? error.name : 'Error',
        correlationId,
      });
      logger.error('mcp.request.failed', {
        tenantId: tenant.tenantId,
        environment: tenant.environment,
        outcome: 'failed',
        durationMs: Date.now() - startMs,
      });
      return {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
        jsonBody: {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        },
      };
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  };
}

export function createProductionMcpHandler(): ReturnType<typeof createMcpHandler> {
  let storePromise: Promise<BlobTemplateStore> | undefined;
  const store = (): Promise<BlobTemplateStore> => {
    if (!storePromise) {
      storePromise = BlobTemplateStore.fromEnv().catch((error: unknown) => {
        storePromise = undefined;
        throw error;
      });
    }
    return storePromise;
  };
  return createMcpHandler(
    createDefaultMcpDependencies({
      load: async (tenant, key) => (await store()).load(tenant, key),
      list: async (tenant) => (await store()).list(tenant),
    }),
  );
}
