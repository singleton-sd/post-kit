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
  type TemplateVariables,
} from '@singleton-sd/post-kit-types';
import { ensureAppConfiguration } from '../config/app-configuration';
import { createLogger, resolveCorrelationId, type Logger } from '../telemetry';
import {
  ApiKeyTenantResolver,
  TenantResolverError,
  type TenantKeyMap,
  type TenantResolver,
} from '../tenant';
import { BlobTemplateStore, TemplateStoreError, type TemplateStore } from '../templates';

const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendHandlerDependencies {
  tenantResolver: TenantResolver;
  templateStore: TemplateStore;
  emailProvider: EmailProvider;
  branding?: TenantBranding;
  createLogger?: typeof createLogger;
  fromAddress?: () => string;
  fromName?: () => string | undefined;
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
    tenantResolver: new ApiKeyTenantResolver(parseTenantKeyMap(process.env.TENANT_KEY_MAP)),
    templateStore,
    emailProvider: createEmailProvider(process.env),
    branding: {},
    fromAddress: () => process.env.EMAIL_FROM_ADDRESS ?? '',
    fromName: () => process.env.EMAIL_FROM_NAME,
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

    const errorResponse = (
      status: number,
      code: PostKitErrorCode,
      error: string,
      outcome: 'failed' | 'validation_error' | 'auth_error' = 'failed',
      extra?: { tenantId?: string; templateKey?: string },
    ): HttpResponseInit => {
      const durationMs = Date.now() - startMs;
      logger.error('send.request.failed', {
        outcome,
        errorCode: code,
        durationMs,
        tenantId: extra?.tenantId,
        templateKey: extra?.templateKey,
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

    let tenantId: string | undefined;
    let templateKey: string | undefined;

    try {
      const tenant = await deps.tenantResolver.resolve(request);
      tenantId = tenant.tenantId;

      const body = await request.json().catch(() => null);
      const parsed = parseSendRequest(body);
      if (!parsed.ok) {
        return errorResponse(400, parsed.code, parsed.error, 'validation_error', { tenantId });
      }
      const sendRequest = parsed.value;
      templateKey = sendRequest.template;

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
          return errorResponse(status, err.code, err.message, 'failed', {
            tenantId,
            templateKey,
          });
        }
        throw err;
      }

      const missing = compiled.metadata.variables.filter(
        (name) => !Object.prototype.hasOwnProperty.call(sendRequest.variables, name),
      );
      if (missing.length > 0) {
        return errorResponse(
          400,
          PostKitErrorCode.MISSING_VARIABLES,
          `Missing required variables: ${missing.join(', ')}`,
          'validation_error',
          { tenantId, templateKey },
        );
      }

      const variables: TemplateVariables = {
        ...(deps.branding ?? {}),
        ...sendRequest.variables,
      };

      const subject = Handlebars.compile(compiled.metadata.subject, { noEscape: false })(variables);
      const html = Handlebars.compile(compiled.templateHtml, { noEscape: false })(variables);

      const fromAddress = (deps.fromAddress ?? (() => process.env.EMAIL_FROM_ADDRESS ?? ''))();
      if (!fromAddress) {
        return errorResponse(
          503,
          PostKitErrorCode.PROVIDER_FAILURE,
          'Email sender is not configured.',
          'failed',
          { tenantId, templateKey },
        );
      }

      const provider = deps.emailProvider;
      const result = await provider.send({
        to: sendRequest.to,
        from: fromAddress,
        fromName: (deps.fromName ?? (() => process.env.EMAIL_FROM_NAME))(),
        subject,
        html,
        correlationId,
      });

      const durationMs = Date.now() - startMs;
      logger.info('send.request.completed', {
        outcome: 'sent',
        durationMs,
        tenantId,
        templateKey,
        providerMessageId: result.providerMessageId,
      });

      const response: SendResponse = { id: correlationId, status: 'sent' };
      return { status: 200, headers, jsonBody: response };
    } catch (error) {
      if (error instanceof TenantResolverError) {
        const status =
          error.code === PostKitErrorCode.UNAUTHENTICATED
            ? 401
            : error.code === PostKitErrorCode.UNAUTHORIZED
              ? 403
              : 401;
        return errorResponse(status, error.code, error.message, 'auth_error', {
          tenantId,
          templateKey,
        });
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
          { tenantId, templateKey },
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
        { tenantId, templateKey },
      );
    }
  };
}

function parseSendRequest(
  body: unknown,
): { ok: true; value: SendRequest } | { ok: false; code: PostKitErrorCode; error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: PostKitErrorCode.INVALID_RECIPIENT,
      error: 'Request body must be a JSON object.',
    };
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj['template'] !== 'string' || !obj['template'].trim()) {
    return { ok: false, code: PostKitErrorCode.INVALID_TEMPLATE, error: 'template is required.' };
  }
  if (typeof obj['to'] !== 'string' || !BASIC_EMAIL.test(obj['to'])) {
    return {
      ok: false,
      code: PostKitErrorCode.INVALID_RECIPIENT,
      error: 'to must be a valid email address.',
    };
  }
  if (
    obj['variables'] === null ||
    typeof obj['variables'] !== 'object' ||
    Array.isArray(obj['variables'])
  ) {
    return {
      ok: false,
      code: PostKitErrorCode.MISSING_VARIABLES,
      error: 'variables must be an object of string values.',
    };
  }
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj['variables'] as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return {
        ok: false,
        code: PostKitErrorCode.MISSING_VARIABLES,
        error: `variables.${key} must be a string.`,
      };
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
