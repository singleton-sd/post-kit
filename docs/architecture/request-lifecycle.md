# Send request lifecycle

What happens inside one `POST /emails/send` call. Every step below is
implemented in [`apps/api/src/functions/send.ts`](../../apps/api/src/functions/send.ts);
supporting behaviour lives in `apps/api/src/tenant/`,
`apps/api/src/templates/`, `apps/api/src/config/`, and
`apps/api/src/telemetry/`.

For the wider system picture see [`overview.md`](./overview.md); for the
tenant boundary see [`multi-tenant-security.md`](./multi-tenant-security.md);
for send idempotency see [`send-idempotency.md`](./send-idempotency.md).

## Route

| Property   | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Method     | `POST`                                                                       |
| Route      | `emails/send`                                                                |
| Auth level | Azure Functions `anonymous` — PostKit does its own bearer-token authentication |
| Request    | `SendRequest`: `{ template, to, variables }`                                  |
| Success    | `200` with `SendResponse`: `{ id, status: 'sent' }` where `id` is the correlation ID |
| Failure    | `PostKitErrorResponse`: `{ error, code, correlationId }`                      |

Tenant identity is never read from the request body — it comes from the
credential.

## Sequence

```text
1.  resolveCorrelationId(x-correlation-id)
        accept caller value only if /^[a-zA-Z0-9_-]{8,128}$/, else crypto.randomUUID()
        create per-request JSON logger bound to the correlation ID
        log send.request.received
        |
2.  ensureAppConfiguration()
        once per worker; no-op when AZURE_APPCONFIGURATION_ENDPOINT is unset
        maps App Configuration keys -> process.env, resolving Key Vault refs
        explicit process.env values always win
        failure -> 503 STORAGE_FAILURE
        |
3.  tenantResolver.resolve(request)
        Authorization: Bearer <token> -> TENANT_KEY_MAP -> { tenantId, environment }
        failure -> 401 UNAUTHENTICATED / 403 UNAUTHORIZED
        |
4.  parseSendRequest(await request.json())
        body must be a JSON object
        template: non-empty string, /^[a-zA-Z0-9._-]+$/, not "." or ".."
        to: matches a basic email shape
        variables: object with string values only
        failure -> 400
        |
5.  templateStore.load(tenant, template)
        GET tenants/{tenantId}/{environment}/templates/{template}/template.html
        GET tenants/{tenantId}/{environment}/templates/{template}/metadata.json
        (fetched in parallel; metadata key and schemaVersion are re-checked)
        failure -> 404 TEMPLATE_NOT_FOUND | 400 INVALID_TEMPLATE | 500
        |
6.  variables = { ...resolveBranding(tenant), ...deps.branding, ...request.variables }
        request-supplied variables win over branding defaults
        |
7.  required-variable check
        every name in metadata.variables must be an own property of variables
        failure -> 400 MISSING_VARIABLES
        |
8.  render
        subject = Handlebars.compile(metadata.subject)(variables)
        html    = Handlebars.compile(templateHtml)(variables)
        HTML-escaping stays on (noEscape: false)
        |
9.  from address / tenant sender config
        resolveTenantEmailConfig(tenant)
        missing -> 503 TENANT_CONFIG_NOT_FOUND / PROVIDER_FAILURE
        |
9b. Idempotency-Key (optional)
        absent -> skip (at-least-once)
        invalid -> 400 before storage
        begin claim in Blob ledger (see send-idempotency.md)
        completed replay -> 200 original SendResponse (no provider call)
        in flight -> 409 IDEMPOTENCY_IN_PROGRESS
        |
10. provider.send({ to, from, fromName, subject, html, correlationId })
        createEmailProvider(process.env) -> development sink or Forward Email
        on success with claim -> complete ledger; on failure -> release claim
        failure -> 502/503 PROVIDER_FAILURE
        |
11. log send.request.completed (outcome, durationMs, tenantId, templateKey,
    providerMessageId) and return 200 { id: correlationId, status: 'sent' }
```

Step ordering matters for two reasons: App Configuration is loaded *before*
the tenant resolver so `TENANT_KEY_MAP` is populated, and branding is merged
*before* the required-variable check so branding values can satisfy declared
template variables.

## Correlation IDs

- A caller may supply `x-correlation-id`. It is accepted only if it is 8–128
  characters of `[a-zA-Z0-9_-]`; otherwise a fresh UUID v4 is generated.
- `X-Correlation-Id` is set on **every** response — 200s and every error path,
  including the App Configuration failure that happens before authentication.
- The success body's `id` field is the same correlation ID.
- Logs are newline-delimited JSON. The logger emits only the fields declared
  on `LogEntry` (`correlationId`, `tenantId`, `environment`, `templateKey`,
  `outcome`, `durationMs`, `providerMessageId`, `failureCategory`,
  `recipientHash`, `errorCode`). Recipient addresses, variable values, and
  tokens are never logged. See [`send-metrics-queries.md`](../operations/send-metrics-queries.md)
  for the field contract and operational queries.

## Error codes and HTTP statuses

Consumers should branch on `code`, not on the message text or the status.

| Condition                                                       | HTTP  | `PostKitErrorCode`   | What the consumer should do                                                              |
| --------------------------------------------------------------- | ----- | -------------------- | ---------------------------------------------------------------------------------------- |
| App Configuration could not be loaded                           | `503` | `STORAGE_FAILURE`    | Retry with backoff. Service-side configuration problem, not a request problem.           |
| Missing `Authorization` header, non-Bearer scheme, empty token   | `401` | `UNAUTHENTICATED`    | Fix the caller: send `Authorization: Bearer <token>`. Do not retry unchanged.             |
| Token is well-formed but not in `TENANT_KEY_MAP`                 | `403` | `UNAUTHORIZED`       | The credential is unknown or revoked. Rotate/reissue it; do not retry.                    |
| Body is not a JSON object                                        | `400` | `INVALID_RECIPIENT`  | Fix the request body. (The code is a shape-check artefact, not a recipient problem.)       |
| `template` missing, empty, or containing unsafe path characters  | `400` | `INVALID_TEMPLATE`   | Fix the template key: `[a-zA-Z0-9._-]+`, not `.` or `..`.                                 |
| `to` is not a valid email address                                | `400` | `INVALID_RECIPIENT`  | Fix the recipient address.                                                                |
| `variables` is not an object, or a value is not a string         | `400` | `MISSING_VARIABLES`  | Send `variables` as a flat object of string values.                                       |
| A variable declared in template metadata was not supplied        | `400` | `MISSING_VARIABLES`  | The message lists the missing names; supply them.                                         |
| Template blob does not exist for this tenant + environment       | `404` | `TEMPLATE_NOT_FOUND` | Publish the template to that environment, or check the credential's environment.          |
| `metadata.json` is malformed, mismatched key, or wrong `schemaVersion`; unsafe key reached the store | `400` | `INVALID_TEMPLATE` | Re-publish the template with `post-kit-publish`.                          |
| Any other template-store failure (e.g. storage unreachable)      | `500` | `PROVIDER_FAILURE`   | Retry with backoff; include the correlation ID in a support request.                       |
| `EMAIL_FROM_ADDRESS` is not configured                           | `503` | `PROVIDER_FAILURE`   | Service-side misconfiguration. Retry later; report the correlation ID.                     |
| Provider failed with kind `configuration`, `transient`, or `rate_limit` | `503` | `PROVIDER_FAILURE` | Retry with backoff.                                                                  |
| Provider failed with any other kind (`validation`, `permanent`, `cancelled`) | `502` | `PROVIDER_FAILURE` | Do not blindly retry — the message was rejected downstream.               |
| Same `Idempotency-Key` still in flight for this tenant                   | `409` | `IDEMPOTENCY_IN_PROGRESS` | Wait and retry the same key; do not start a parallel send.              |
| `Idempotency-Key` present but empty, oversized, or bad charset           | `400` | `INVALID_RECIPIENT` | Fix the header: 1–128 of `[A-Za-z0-9._:~-]`. (Code reused for request-input validation.) |
| Unhandled exception                                              | `500` | `PROVIDER_FAILURE`   | Retry with backoff; report the correlation ID.                                            |

Two things to be aware of when reading the table:

- `STORAGE_FAILURE` is currently emitted **only** for the App Configuration
  load failure. Blob Storage failures that are not "not found" or "invalid
  metadata" surface as `500 PROVIDER_FAILURE`, because `BlobTemplateStore`
  rethrows non-`TemplateStoreError` errors and the generic handler labels
  them `PROVIDER_FAILURE`.
- `TemplateStoreError` with a code other than `TEMPLATE_NOT_FOUND` or
  `INVALID_TEMPLATE` maps to `500`, but the store never constructs such an
  error today, so that branch is unreachable in practice.

## Client-side behaviour

`@singleton-sd/post-kit-client` wraps this endpoint:

- Sends `Authorization: Bearer <apiKey>` and `Content-Type: application/json`
  to `{endpoint}/emails/send`.
- Non-2xx responses become `PostKitRequestError` carrying `code` (the
  `PostKitErrorCode` from the body, or `HTTP_<status>` when the body has
  none), `status`, and `correlationId`.
- Timeouts (default 30s, `timeout: 0` disables) and network failures become
  `PostKitRequestError` with code `TIMEOUT` or `NETWORK_ERROR`. A caller's own
  `AbortSignal` abort is rethrown unchanged rather than relabelled.
