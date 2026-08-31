import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import Handlebars from 'handlebars';
import {
  createEmailProvider,
  EmailProviderError,
  type EmailProvider,
} from '@singleton-sd/post-kit-email';
import {
  PostKitErrorCode,
  type PostKitErrorResponse,
  type SendRequest,
  type SendResponse,
  type TenantBranding,
  type TenantContext,
  type TenantEnvironment,
  type TemplateVariables,
} from '@singleton-sd/post-kit-types';
import { ensureAppConfiguration } from '../config/app-configuration';
import { createLogger, hashRecipient, resolveCorrelationId, type Logger } from '../telemetry';
import {
  ApiKeyTenantResolver,
  TenantResolverError,
  resolveTenantEmailConfig,
  TenantEmailConfigError,
  type ResolvedTenantEmailConfig,
  type TenantKeyMap,
  type TenantResolver,
} from '../tenant';
import { BlobTemplateStore, TemplateStoreError, type TemplateStore } from '../templates';

const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Same allowlist as BlobTemplateStore — reject path traversal before load. */
const SAFE_TEMPLATE_KEY = /^[a-zA-Z0-9._-]+$/;

export interface SendHandlerDependencies {
  tenantResolver: TenantResolver;
  templateStore: TemplateStore;
  /** Prefer injecting a factory so App Configuration can populate env first. */
  createEmailProvider?: (options?: { apiToken?: string }) => EmailProvider;
  /** Direct provider injection for unit tests. */
  emailProvider?: EmailProvider;
  /**
   * Resolve tenant branding defaults after auth. Merged before required-variable
   * validation so branding can satisfy template variables.
   */
  resolveBranding?: (tenant: TenantContext) => Promise<TenantBranding> | TenantBranding;
  /** Static branding for tests (applied after resolveBranding). */
  branding?: TenantBranding;
  /**
   * Resolve tenant sender identity after auth. Merged with platform defaults in
   * `resolveTenantEmailConfig`; request bodies cannot override sender fields.
   */
  resolveTenantEmailConfig?: (
    tenant: TenantContext,
  ) => Promise<ResolvedTenantEmailConfig> | ResolvedTenantEmailConfig;
  createLogger?: typeof createLogger;
}

function parseTenantKeyMap(raw: string | undefined): TenantKeyMap {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as TenantKeyMap;
  } catch {
    return {};
  }
}

export function createDefaultSendDependencies(
  templateStore: TemplateStore,
): SendHandlerDependencies {
  return {
    // Re-read env after App Configuration in the handler via factories.
    get tenantResolver(): TenantResolver {
      return new ApiKeyTenantResolver(parseTenantKeyMap(process.env.TENANT_KEY_MAP));
    },
    templateStore,
    createEmailProvider: (options) => createEmailProvider(process.env, options),
    resolveBranding: async () => ({}),
    resolveTenantEmailConfig: (tenant) => resolveTenantEmailConfig(tenant),
  };
}

export function createSendHandler(deps: SendHandlerDependencies) {
  return async function sendHandler(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const startMs = Date.now();
    const correlationId = resolveCorrelationId(
      request.headers.get('x-correlation-id') ?? undefined,
    );
    const logger: Logger = (deps.createLogger ?? createLogger)(correlationId);

    logger.info('send.request.received');

    const headers = {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
    };

    let tenantId: string | undefined;
    let environment: TenantEnvironment | undefined;
    let templateKey: string | undefined;
    let recipientHash: string | undefined;

    const logContext = (): {
      tenantId?: string;
      environment?: TenantEnvironment;
      templateKey?: string;
      recipientHash?: string;
    } => ({
      tenantId,
      environment,
      templateKey,
      recipientHash,
    });

    const errorResponse = (
      status: number,
      code: PostKitErrorCode,
      error: string,
      outcome: 'failed' | 'validation_error' | 'auth_error' = 'failed',
      extra?: {
        failureCategory?: string;
        providerMessageId?: string;
        providerRequestId?: string;
      },
    ): HttpResponseInit => {
      const durationMs = Date.now() - startMs;
      const failureCategory = extra?.failureCategory ?? failureCategoryFromErrorCode(code, outcome);
      logger.error('send.request.failed', {
        outcome,
        errorCode: code,
        failureCategory,
        durationMs,
        providerMessageId: extra?.providerMessageId,
        providerRequestId: extra?.providerRequestId,
        ...logContext(),
      });
      const body: PostKitErrorResponse = { error, code, correlationId };
      return { status, headers, jsonBody: body };
    };

    try {
      await ensureAppConfiguration();
    } catch (error) {
      context.error('app configuration load failed', {
        name: error instanceof Error ? error.name : 'Error',
      });
      return errorResponse(
        503,
        PostKitErrorCode.STORAGE_FAILURE,
        'Service configuration is temporarily unavailable.',
      );
    }

    try {
      const tenant = await deps.tenantResolver.resolve(request);
      tenantId = tenant.tenantId;
      environment = tenant.environment;

      const body = await request.json().catch(() => null);
      const parsed = parseSendRequest(body);
      if (!parsed.ok) {
        if (parsed.templateKey) {
          templateKey = parsed.templateKey;
        }
        if (parsed.recipientHash) {
          recipientHash = parsed.recipientHash;
        }
        return errorResponse(400, parsed.code, parsed.error, 'validation_error');
      }
      const sendRequest = parsed.value;
      templateKey = sendRequest.template;
      recipientHash = hashRecipient(sendRequest.to);

      let compiled;
      try {
        compiled = await deps.templateStore.load(tenant, sendRequest.template);
      } catch (err) {
        if (err instanceof TemplateStoreError) {
          const status =
            err.code === PostKitErrorCode.TEMPLATE_NOT_FOUND
              ? 404
              : err.code === PostKitErrorCode.INVALID_TEMPLATE
                ? 400
                : 500;
          return errorResponse(status, err.code, err.message, 'failed');
        }
        throw err;
      }

      const resolvedBranding = deps.resolveBranding ? await deps.resolveBranding(tenant) : {};
      const variables: TemplateVariables = {
        ...resolvedBranding,
        ...(deps.branding ?? {}),
        ...sendRequest.variables,
      };

      const missing = compiled.metadata.variables.filter(
        (name) => !Object.prototype.hasOwnProperty.call(variables, name),
      );
      if (missing.length > 0) {
        return errorResponse(
          400,
          PostKitErrorCode.MISSING_VARIABLES,
          `Missing required variables: ${missing.join(', ')}`,
          'validation_error',
        );
      }

      const subject = Handlebars.compile(compiled.metadata.subject, { noEscape: false })(variables);
      const html = Handlebars.compile(compiled.templateHtml, { noEscape: false })(variables);

      const resolveTenantEmailConfigFn =
        deps.resolveTenantEmailConfig ?? ((tenant) => resolveTenantEmailConfig(tenant));
      const tenantEmailConfig = await resolveTenantEmailConfigFn(tenant);

      const provider =
        deps.emailProvider ??
        (deps.createEmailProvider ?? ((options) => createEmailProvider(process.env, options)))(
          tenantEmailConfig.providerApiToken
            ? { apiToken: tenantEmailConfig.providerApiToken }
            : undefined,
        );
      const result = await provider.send({
        to: sendRequest.to,
        from: tenantEmailConfig.fromAddress,
        fromName: tenantEmailConfig.fromDisplayName,
        replyTo: tenantEmailConfig.replyTo,
        subject,
        html,
        correlationId,
      });

      const durationMs = Date.now() - startMs;
      logger.info('send.request.completed', {
        outcome: 'sent',
        durationMs,
        providerMessageId: result.providerMessageId,
        ...logContext(),
      });

      const response: SendResponse = { id: correlationId, status: 'sent' };
      return { status: 200, headers, jsonBody: response };
    } catch (error) {
      if (error instanceof TenantEmailConfigError) {
        return errorResponse(503, error.code, error.message, 'failed', {
          failureCategory: 'tenant_config_not_found',
        });
      }

      if (error instanceof TenantResolverError) {
        const status =
          error.code === PostKitErrorCode.UNAUTHENTICATED
            ? 401
            : error.code === PostKitErrorCode.UNAUTHORIZED
              ? 403
              : 401;
        return errorResponse(status, error.code, error.message, 'auth_error');
      }

      if (error instanceof EmailProviderError) {
        context.error('send provider failed', {
          kind: error.kind,
          statusCode: error.statusCode,
          correlationId,
        });
        return errorResponse(
          error.kind === 'configuration' ||
            error.kind === 'transient' ||
            error.kind === 'rate_limit'
            ? 503
            : 502,
          PostKitErrorCode.PROVIDER_FAILURE,
          'Email provider failed to send the message.',
          'failed',
          {
            failureCategory: error.failureCategory,
            providerRequestId: error.providerRequestId,
          },
        );
      }

      context.error('send failed', {
        name: error instanceof Error ? error.name : 'Error',
        correlationId,
      });
      return errorResponse(
        500,
        PostKitErrorCode.PROVIDER_FAILURE,
        'We could not send your message. Please try again shortly.',
        'failed',
        { failureCategory: 'unhandled' },
      );
    }
  };
}

function failureCategoryFromErrorCode(
  code: PostKitErrorCode,
  outcome: 'failed' | 'validation_error' | 'auth_error',
): string {
  if (outcome === 'auth_error') {
    return code === PostKitErrorCode.UNAUTHENTICATED ? 'auth_unauthenticated' : 'auth_unauthorized';
  }
  switch (code) {
    case PostKitErrorCode.INVALID_TEMPLATE:
      return 'invalid_template';
    case PostKitErrorCode.INVALID_RECIPIENT:
      return 'invalid_recipient';
    case PostKitErrorCode.MISSING_VARIABLES:
      return 'missing_variables';
    case PostKitErrorCode.TEMPLATE_NOT_FOUND:
      return 'template_not_found';
    case PostKitErrorCode.STORAGE_FAILURE:
      return 'storage_failure';
    case PostKitErrorCode.TENANT_CONFIG_NOT_FOUND:
      return 'tenant_config_not_found';
    case PostKitErrorCode.PROVIDER_FAILURE:
      return 'provider_failure';
    default:
      return 'unknown';
  }
}

function isSafeTemplateKey(templateKey: string): boolean {
  return (
    Boolean(templateKey) &&
    templateKey !== '.' &&
    templateKey !== '..' &&
    SAFE_TEMPLATE_KEY.test(templateKey)
  );
}

function parseSendRequest(body: unknown):
  | { ok: true; value: SendRequest }
  | {
      ok: false;
      code: PostKitErrorCode;
      error: string;
      templateKey?: string;
      recipientHash?: string;
    } {
  let templateKey: string | undefined;
  let recipientHash: string | undefined;

  const fail = (
    code: PostKitErrorCode,
    error: string,
  ): {
    ok: false;
    code: PostKitErrorCode;
    error: string;
    templateKey?: string;
    recipientHash?: string;
  } => ({
    ok: false,
    code,
    error,
    templateKey,
    recipientHash,
  });

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail(PostKitErrorCode.INVALID_RECIPIENT, 'Request body must be a JSON object.');
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj['template'] !== 'string' || !obj['template'].trim()) {
    return fail(PostKitErrorCode.INVALID_TEMPLATE, 'template is required.');
  }
  if (!isSafeTemplateKey(obj['template'])) {
    return fail(PostKitErrorCode.INVALID_TEMPLATE, 'template key contains unsafe path characters.');
  }
  templateKey = obj['template'];

  if (typeof obj['to'] !== 'string' || !BASIC_EMAIL.test(obj['to'])) {
    return fail(PostKitErrorCode.INVALID_RECIPIENT, 'to must be a valid email address.');
  }
  recipientHash = hashRecipient(obj['to']);

  if (
    obj['variables'] === null ||
    typeof obj['variables'] !== 'object' ||
    Array.isArray(obj['variables'])
  ) {
    return fail(
      PostKitErrorCode.MISSING_VARIABLES,
      'variables must be an object of string values.',
    );
  }
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj['variables'] as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return fail(PostKitErrorCode.MISSING_VARIABLES, `variables.${key} must be a string.`);
    }
    variables[key] = value;
  }

  return {
    ok: true,
    value: {
      template: obj['template'],
      to: obj['to'],
      variables,
    },
  };
}

const productionHandler = createSendHandler(
  createDefaultSendDependencies({
    load: async (tenant, key) => (await BlobTemplateStore.fromEnv()).load(tenant, key),
  }),
);

app.http('emailsSend', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'emails/send',
  handler: productionHandler,
});

export { productionHandler as sendHandler };
