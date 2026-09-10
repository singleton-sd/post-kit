import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { PostKitErrorCode, type Principal, type TenantContext } from '@singleton-sd/post-kit-types';
import {
  ApiKeyAuthenticator,
  AuthError,
  parseTenantKeyRegistry,
  tenantContextFromPrincipal,
  type Authenticator,
} from '../auth';
import { ensureAppConfiguration } from '../config/app-configuration';
import { createLogger, resolveCorrelationId, type Logger } from '../telemetry';
import { BlobTemplateStore, TemplateApplicationService, type TemplateStore } from '../templates';
import { createPostkitMcpServer } from './create-server';
import { azureHttpRequestToWebRequest, webResponseToAzureHttpResponse } from './http-bridge';

const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Correlation-Id, mcp-session-id, mcp-protocol-version',
} as const;

export interface McpHandlerDependencies {
  authenticator: Authenticator;
  templateStore: TemplateStore;
  resolveBranding?: (
    tenant: TenantContext,
  ) => Promise<Record<string, string>> | Record<string, string>;
  createLogger?: typeof createLogger;
}

/** Sanitize-parse TENANT_KEY_MAP. Never logs raw contents or credentials. */
export function parseTenantKeyMap(raw: string | undefined, log: Logger = createLogger('config')) {
  return parseTenantKeyRegistry(raw, log);
}

export function createDefaultMcpDependencies(templateStore: TemplateStore): McpHandlerDependencies {
  return {
    get authenticator(): Authenticator {
      return new ApiKeyAuthenticator(
        parseTenantKeyRegistry(process.env.TENANT_KEY_MAP, createLogger('config')),
      );
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

    let principal: Principal;
    try {
      principal = await deps.authenticator.authenticate(request);
    } catch (err) {
      if (err instanceof AuthError) {
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

    const tenant = tenantContextFromPrincipal(principal);

    const templates = new TemplateApplicationService({
      templateStore: deps.templateStore,
      resolveBranding: deps.resolveBranding,
    });

    const server = createPostkitMcpServer({
      templates,
      principal,
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
        principalId: principal.id,
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
        principalId: principal.id,
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
