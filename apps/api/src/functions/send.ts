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
import { getSendRateLimiter, sendRateLimitKey } from '../contact-rate-limit';
import {
  BlobIdempotencyStore,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyStoreError,
  validateIdempotencyKey,
  type IdempotencyStore,
} from '../idempotency';
import {
  DeliveryFailureError,
  deliverSend,
  resolveSendDeliveryPolicy,
  SendTimeoutError,
  type SendDeliveryPolicy,
} from '../send-delivery';
import { getSendSizeLimits, validateRequestBodySize, validateVariablesSize } from '../send-limits';
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
  createEmailProvider?: (options?: {
    apiToken?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) => EmailProvider;
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
  /**
   * Out-of-process idempotency ledger. When omitted, production resolves a
   * Blob store from env; unit tests inject `MemoryIdempotencyStore` or leave
   * unset when no Idempotency-Key header is sent.
   */
  idempotencyStore?: IdempotencyStore;
  /** Lazy factory for production (loads App Configuration first). */
  createIdempotencyStore?: () => Promise<IdempotencyStore>;
  /** Override timeout/retry policy (tests). Defaults from env via resolveSendDeliveryPolicy. */
  deliveryPolicy?: SendDeliveryPolicy;
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
    createEmailProvider: (options) =>
      createEmailProvider(process.env, {
        ...options,
        // Send path owns timeout + idempotency-gated retry; disable provider-internal retries.
        maxRetries: options?.maxRetries ?? 0,
      }),
    resolveBranding: async () => ({}),
    resolveTenantEmailConfig: (tenant) => resolveTenantEmailConfig(tenant),
    createIdempotencyStore: () => BlobIdempotencyStore.fromEnv(),
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
        failureClass?: 'transient' | 'permanent';
        attempt?: number;
        providerMessageId?: string;
        providerRequestId?: string;
        retryAfterSec?: number;
      },
    ): HttpResponseInit => {
      const durationMs = Date.now() - startMs;
      const failureCategory = extra?.failureCategory ?? failureCategoryFromErrorCode(code, outcome);
      logger.error('send.request.failed', {
        outcome,
        errorCode: code,
        failureCategory,
        failureClass: extra?.failureClass,
        attempt: extra?.attempt,
        durationMs,
        providerMessageId: extra?.providerMessageId,
        providerRequestId: extra?.providerRequestId,
        ...logContext(),
      });
      const body: PostKitErrorResponse = { error, code, correlationId };
      const responseHeaders: Record<string, string> = { ...headers };
      if (extra?.retryAfterSec !== undefined) {
        responseHeaders['Retry-After'] = String(extra.retryAfterSec);
      }
      return { status, headers: responseHeaders, jsonBody: body };
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

      const limit = getSendRateLimiter().tryConsume(sendRateLimitKey(tenant));
      if (!limit.allowed) {
        return errorResponse(
          429,
          PostKitErrorCode.RATE_LIMITED,
          'Too many send requests for this tenant. Please wait and try again.',
          'failed',
          { failureCategory: 'rate_limited', retryAfterSec: limit.retryAfterSec },
        );
      }

      const rawIdempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
      let idempotencyKey: string | undefined;
      if (rawIdempotencyKey !== null && rawIdempotencyKey !== undefined) {
        // Header present (including empty) — validate before any storage access.
        const validated = validateIdempotencyKey(rawIdempotencyKey);
        if (!validated.ok) {
          return errorResponse(
            400,
            PostKitErrorCode.INVALID_RECIPIENT,
            validated.error,
            'validation_error',
            { failureCategory: 'invalid_idempotency_key' },
          );
        }
        idempotencyKey = validated.key;
      }

      const sizeLimits = getSendSizeLimits();
      let rawBody: string;
      try {
        rawBody = await request.text();
      } catch {
        return errorResponse(
          400,
          PostKitErrorCode.INVALID_RECIPIENT,
          'Request body could not be read.',
          'validation_error',
        );
      }
      const bodySize = validateRequestBodySize(rawBody, sizeLimits);
      if (!bodySize.ok) {
        return errorResponse(
          400,
          PostKitErrorCode.PAYLOAD_TOO_LARGE,
          bodySize.error,
          'validation_error',
        );
      }

      let body: unknown;
      try {
        body = rawBody.trim() ? JSON.parse(rawBody) : null;
      } catch {
        return errorResponse(
          400,
          PostKitErrorCode.INVALID_RECIPIENT,
          'Request body must be valid JSON.',
          'validation_error',
        );
      }

      const parsed = parseSendRequest(body, sizeLimits);
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
        (
          deps.createEmailProvider ??
          ((options) =>
            createEmailProvider(process.env, {
              ...options,
              maxRetries: options?.maxRetries ?? 0,
            }))
        )(
          tenantEmailConfig.providerApiToken
            ? { apiToken: tenantEmailConfig.providerApiToken }
            : undefined,
        );

      const deliveryPolicy = deps.deliveryPolicy ?? resolveSendDeliveryPolicy();

      let idempotencyStore: IdempotencyStore | undefined;
      let idempotencyClaimed = false;
      let idempotencyClaimToken: string | undefined;
      let idempotencyReleased = false;
      if (idempotencyKey) {
        try {
          idempotencyStore =
            deps.idempotencyStore ??
            (deps.createIdempotencyStore ? await deps.createIdempotencyStore() : undefined);
        } catch (err) {
          if (err instanceof IdempotencyStoreError) {
            return errorResponse(503, err.code, err.message, 'failed');
          }
          context.error('idempotency store init failed', {
            name: err instanceof Error ? err.name : 'Error',
            correlationId,
          });
          return errorResponse(
            503,
            PostKitErrorCode.STORAGE_FAILURE,
            'Idempotency storage is temporarily unavailable.',
          );
        }
        if (!idempotencyStore) {
          return errorResponse(
            503,
            PostKitErrorCode.STORAGE_FAILURE,
            'Idempotency storage is not configured.',
          );
        }

        let beginResult;
        try {
          beginResult = await idempotencyStore.begin(tenant, idempotencyKey);
        } catch (err) {
          if (err instanceof IdempotencyStoreError) {
            return errorResponse(503, err.code, err.message, 'failed');
          }
          throw err;
        }

        if (beginResult.outcome === 'replay') {
          const durationMs = Date.now() - startMs;
          logger.info('send.request.completed', {
            outcome: 'sent',
            durationMs,
            ...logContext(),
          });
          // Keep the current request correlation ID in the response header so
          // callers can correlate this invocation's logs; the original send id
          // remains in the body.
          return { status: 200, headers, jsonBody: beginResult.response };
        }

        if (beginResult.outcome === 'in_progress') {
          return errorResponse(
            409,
            PostKitErrorCode.IDEMPOTENCY_IN_PROGRESS,
            'A request with this Idempotency-Key is already in progress for this tenant.',
            'failed',
            { failureCategory: 'idempotency_in_progress' },
          );
        }

        idempotencyClaimed = true;
        idempotencyClaimToken = beginResult.claimToken;
      }

      try {
        const delivery = await deliverSend(
          provider,
          {
            to: sendRequest.to,
            from: tenantEmailConfig.fromAddress,
            fromName: tenantEmailConfig.fromDisplayName,
            replyTo: tenantEmailConfig.replyTo,
            subject,
            html,
            correlationId,
          },
          {
            policy: deliveryPolicy,
            // Retry only while we hold the claim — reuse the same record; never
            // release between attempts (that would allow a parallel claim).
            allowRetry: idempotencyClaimed,
            onAttempt: (info) => {
              if (info.failureClass) {
                logger.info('send.provider.attempt', {
                  outcome: 'failed',
                  failureClass: info.failureClass,
                  failureCategory: info.failureCategory,
                  attempt: info.attempt,
                  ...logContext(),
                });
              }
            },
          },
        );

        if (!delivery.ok) {
          if (idempotencyClaimed && idempotencyStore && idempotencyKey && idempotencyClaimToken) {
            try {
              await idempotencyStore.release(tenant, idempotencyKey, idempotencyClaimToken);
              idempotencyReleased = true;
            } catch {
              // Prefer the original send failure; release is best-effort.
            }
          }
          throw delivery.error;
        }

        const result = delivery.result;
        const response: SendResponse = { id: correlationId, status: 'sent' };

        if (idempotencyClaimed && idempotencyStore && idempotencyKey && idempotencyClaimToken) {
          try {
            await completeIdempotencyWithRetry(
              idempotencyStore,
              tenant,
              idempotencyKey,
              response,
              idempotencyClaimToken,
            );
          } catch (err) {
            // Provider already accepted the message — do not return 200 while the
            // ledger is still in_progress (that would 409 retries until TTL, then
            // risk a second send). Ask the client to retry the same key after we
            // failed to persist completion.
            context.error('idempotency complete failed', {
              name: err instanceof Error ? err.name : 'Error',
              correlationId,
            });
            return errorResponse(
              503,
              err instanceof IdempotencyStoreError ? err.code : PostKitErrorCode.STORAGE_FAILURE,
              'The message was accepted by the provider but the idempotency record could not be saved. Retry with the same Idempotency-Key.',
              'failed',
              { failureCategory: 'idempotency_complete_failed' },
            );
          }
        }

        const durationMs = Date.now() - startMs;
        logger.info('send.request.completed', {
          outcome: 'sent',
          durationMs,
          providerMessageId: result.providerMessageId,
          attempt: delivery.attempts,
          ...logContext(),
        });

        return { status: 200, headers, jsonBody: response };
      } catch (sendError) {
        if (
          !idempotencyReleased &&
          idempotencyClaimed &&
          idempotencyStore &&
          idempotencyKey &&
          idempotencyClaimToken
        ) {
          try {
            await idempotencyStore.release(tenant, idempotencyKey, idempotencyClaimToken);
          } catch {
            // Prefer the original send failure; release is best-effort.
          }
        }
        throw sendError;
      }
    } catch (error) {
      if (error instanceof IdempotencyStoreError) {
        return errorResponse(503, error.code, error.message, 'failed');
      }

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

      if (error instanceof DeliveryFailureError) {
        const cause = error.cause;
        if (cause instanceof SendTimeoutError || error.failureCategory === 'timeout') {
          const timeoutMs = cause instanceof SendTimeoutError ? cause.timeoutMs : undefined;
          context.error('send provider timed out', {
            timeoutMs,
            correlationId,
          });
          return errorResponse(
            503,
            PostKitErrorCode.PROVIDER_FAILURE,
            'Email provider timed out while sending the message.',
            'failed',
            {
              failureCategory: 'timeout',
              failureClass: 'transient',
              attempt: error.attempts,
            },
          );
        }

        if (cause instanceof EmailProviderError) {
          context.error('send provider failed', {
            kind: cause.kind,
            statusCode: cause.statusCode,
            correlationId,
          });
          return errorResponse(
            cause.kind === 'configuration' ||
              cause.kind === 'transient' ||
              cause.kind === 'rate_limit'
              ? 503
              : 502,
            PostKitErrorCode.PROVIDER_FAILURE,
            'Email provider failed to send the message.',
            'failed',
            {
              failureCategory: error.failureCategory,
              failureClass: error.failureClass,
              attempt: error.attempts,
              providerRequestId: cause.providerRequestId,
            },
          );
        }

        context.error('send failed', {
          name: cause instanceof Error ? cause.name : 'Error',
          correlationId,
        });
        return errorResponse(
          error.failureClass === 'transient' ? 503 : 500,
          PostKitErrorCode.PROVIDER_FAILURE,
          'We could not send your message. Please try again shortly.',
          'failed',
          {
            failureCategory: error.failureCategory,
            failureClass: error.failureClass,
            attempt: error.attempts,
          },
        );
      }

      if (error instanceof SendTimeoutError) {
        context.error('send provider timed out', {
          timeoutMs: error.timeoutMs,
          correlationId,
        });
        return errorResponse(
          503,
          PostKitErrorCode.PROVIDER_FAILURE,
          'Email provider timed out while sending the message.',
          'failed',
          {
            failureCategory: 'timeout',
            failureClass: 'transient',
          },
        );
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
            failureClass:
              error.kind === 'transient' || error.kind === 'rate_limit' ? 'transient' : 'permanent',
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

const IDEMPOTENCY_COMPLETE_ATTEMPTS = 3;

/**
 * Persist a completed idempotency record before acknowledging success to the
 * caller. Retries briefly so transient storage blips do not leave an
 * `in_progress` claim after a successful provider send.
 */
async function completeIdempotencyWithRetry(
  store: IdempotencyStore,
  tenant: TenantContext,
  key: string,
  response: SendResponse,
  claimToken: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= IDEMPOTENCY_COMPLETE_ATTEMPTS; attempt += 1) {
    try {
      await store.complete(tenant, key, response, claimToken);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < IDEMPOTENCY_COMPLETE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new IdempotencyStoreError(
        'Failed to persist completed idempotency record.',
        PostKitErrorCode.STORAGE_FAILURE,
      );
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
    case PostKitErrorCode.PAYLOAD_TOO_LARGE:
      return 'payload_too_large';
    case PostKitErrorCode.RATE_LIMITED:
      return 'rate_limited';
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
    case PostKitErrorCode.IDEMPOTENCY_IN_PROGRESS:
      return 'idempotency_in_progress';
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

function parseSendRequest(
  body: unknown,
  sizeLimits = getSendSizeLimits(),
):
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

  const variablesSize = validateVariablesSize(variables, sizeLimits);
  if (!variablesSize.ok) {
    return fail(PostKitErrorCode.PAYLOAD_TOO_LARGE, variablesSize.error);
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
