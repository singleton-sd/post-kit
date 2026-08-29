# Operational troubleshooting — `POST /emails/send`

Triage reference for "the email didn't arrive". HTTP responses and structured
logs identify the outcome and the next check — no source reading required for
initial triage. The runbooks below also point at Blob Storage, App
Configuration, Key Vault, DNS, and the recipient mailbox when those are the
likely cause.

Scope: the send endpoint implemented in `apps/api/src/functions/send.ts`, its
tenant resolver, template store, App Configuration loader, and the
`EmailProvider` adapters in `@singleton-sd/post-kit-email`.

**A `200` means the email provider accepted the message, not that it reached an
inbox.** PostKit has no delivery confirmation today — see
[What is not observable today](#what-is-not-observable-today).

## Error response shape

Every failure returns JSON with a stable machine-readable code:

```json
{
  "error": "human readable message",
  "code": "TEMPLATE_NOT_FOUND",
  "correlationId": "3f1a0c2e-8f6b-4a15-9a1f-2b0d5e7c9a34"
}
```

Every response — success and failure — also carries the `X-Correlation-Id`
response header. Always ask a reporter for that value first.

## Triage table

One row per distinct outcome the current handler can produce. Rows are
independent: new error codes are appended as new rows without changing existing
ones.

| HTTP | `code` | Symptom | Likely cause | What to check | Retry appropriate? |
| --- | --- | --- | --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Rejected before any template work; no `tenantId` in the log entry | No `Authorization` header, header does not use the `Bearer` scheme (case-insensitive), or the bearer token is empty | That the caller sends `Authorization: Bearer <token>`. The resolver never logs the token, so confirm header presence on the caller side | No — retrying the same request fails identically |
| 403 | `UNAUTHORIZED` | Well-formed credential still rejected; no `tenantId` in the log entry | The token is not an own key of the `TENANT_KEY_MAP` entry map (also rejects prototype names such as `toString`) | Whether `TENANT_KEY_MAP` contains the caller's token, and whether it was rotated or the map JSON failed to parse (an unparseable map silently becomes empty, so every token 403s) | No — until the key map is corrected |
| 400 | `INVALID_TEMPLATE` | Request rejected at body validation, `outcome=validation_error` | `template` missing, not a string, blank, or containing characters outside `[a-zA-Z0-9._-]` (also the bare `.` and `..` keys) | The `template` value the caller sent | No — fix the request |
| 400 | `INVALID_TEMPLATE` | Rejected after the blob was fetched, `outcome=failed`, `templateKey` present | `metadata.json` is not valid JSON, is missing required fields, has a `key` that differs from the requested key, or declares an unsupported `schemaVersion` | The published `metadata.json` artefact for that tenant/environment/key; re-run the template publish | No — republish the template first |
| 400 | `INVALID_RECIPIENT` | Rejected at body validation, `outcome=validation_error` | Request body is not a JSON object (null, array, or unparseable), or `to` is not a string matching basic `local@domain.tld` validation | The caller's request shape and `Content-Type`. Do not paste the body into a ticket — it contains a recipient address | No — fix the request |
| 400 | `MISSING_VARIABLES` | Rejected at validation, message lists the offending names | `variables` is absent/not an object, one of its values is not a string, or a variable declared in the template metadata is not supplied (after tenant branding defaults are merged in) | The `variables` declared in the template's `metadata.json` against the caller's keys. Values are never logged | No — fix the request or the template metadata |
| 404 | `TEMPLATE_NOT_FOUND` | Valid key, `outcome=failed`, `templateKey` present | No blob at `tenants/{tenantId}/{environment}/templates/{templateKey}/template.html` or `/metadata.json` | See [Runbook 1](#runbook-1--template-not-found) | No — until the template is published |
| 503 | `PROVIDER_FAILURE` | Message `Email sender is not configured.`; fails after template compilation, before the provider is constructed | `EMAIL_FROM_ADDRESS` is unset in Function App settings and in App Configuration (`app:email:fromAddress`) | The Function App application settings and App Configuration key | Only after configuration is fixed |
| 503 | `PROVIDER_FAILURE` | Provider rejected the send; `send provider failed` is logged with `kind=configuration` | Provider credential missing — e.g. `FORWARD_EMAIL_TOKEN` not resolved from Key Vault via App Configuration, or a malformed contact profile configuration | Key Vault reference resolution for `secret:forwardemail-api-key`; the Function App's managed identity access to Key Vault | Only after configuration is fixed |
| 503 | `PROVIDER_FAILURE` | Intermittent; `kind=transient`, often with `statusCode` 5xx/408/409, or a request timeout (15 s) or transport failure | Provider outage, network failure, or timeout. The provider already retried internally (up to 2 retries with backoff) before surfacing this | Provider status; whether `durationMs` is near the timeout ceiling | Yes — retry with backoff |
| 503 | `PROVIDER_FAILURE` | Bursty failures under load; `kind=rate_limit`, `statusCode=429` | Provider rate limit reached after internal retries | Send volume for the affected window across all tenants | Yes — back off, then retry |
| 502 | `PROVIDER_FAILURE` | Consistent failure for a specific request; `kind=permanent` with a provider 4xx `statusCode` (other than 429/408/409) | Provider rejected the message permanently — e.g. unverified sender domain, unauthorized credential, malformed payload | Sender identity and domain setup, see [`email-forward-email.md`](../email-forward-email.md) | No — the same request fails again |
| 502 | `PROVIDER_FAILURE` | Failure before any provider HTTP call; `kind=validation` | A header field (`to`, `from`, `subject`, `replyTo`) is empty after sanitisation or contains CR/LF control characters — typically a template subject rendered from a variable | The rendered subject and the configured sender address for stray newlines | No — fix the template or input |
| 502 | `PROVIDER_FAILURE` | Rare; `kind=cancelled` | The send was aborted (caller/host cancellation) | Host shutdown, scaling events, or client disconnects in the same window | Yes — the message was probably never sent, but confirm no duplicate first |
| 503 | `STORAGE_FAILURE` | Fails immediately, before auth; no `tenantId` or `templateKey`; `app configuration load failed` is logged | Azure App Configuration load threw — endpoint unreachable, identity lacks access, or a Key Vault reference is invalid or has no value | `AZURE_APPCONFIGURATION_ENDPOINT`, the Function App managed identity's App Configuration and Key Vault role assignments | Yes — the loader clears its cache on failure and retries on the next request |
| 500 | `PROVIDER_FAILURE` | Unexpected failure; `send failed` is logged with only the error `name` | Any unhandled exception — e.g. a Blob Storage error that is not a not-found (auth, throttling, network), or a Handlebars compilation failure | The `send failed` entry's error `name` for that correlation ID, plus Function App exception telemetry | Yes once, but escalate if it repeats |

Notes on reading this table:

- `PROVIDER_FAILURE` is the code returned for **both** provider errors and the
  catch-all `500`. Use the HTTP status plus the `send provider failed` /
  `send failed` log entry to tell them apart — only provider errors log a
  `kind`.
- `STORAGE_FAILURE` is currently returned **only** for App Configuration load
  failure. Blob Storage failures other than "not found" surface as `500`.
- All eight `PostKitErrorCode` values are reachable from this endpoint and all
  eight appear above: `UNAUTHENTICATED`, `UNAUTHORIZED`, `INVALID_TEMPLATE`,
  `INVALID_RECIPIENT`, `MISSING_VARIABLES`, `TEMPLATE_NOT_FOUND`,
  `PROVIDER_FAILURE`, `STORAGE_FAILURE`.

## Correlation IDs and log fields

### How the ID is chosen

- If the request supplies an `x-correlation-id` header whose value is 8–128
  characters of `[A-Za-z0-9_-]`, that value is used verbatim.
- Otherwise (missing, empty, or failing validation) a fresh UUID v4 is
  generated.
- The chosen value is returned as the `X-Correlation-Id` response header on
  every response, is present as `correlationId` in every error body, and is
  also returned as the `id` field of a successful `SendResponse`.
- It is forwarded to the provider as an `X-Correlation-Id` request header, so
  provider-side logs can be joined on the same value.

### Structured log events

The handler emits newline-delimited JSON via the per-request logger. Three
events cover a send:

| Event (`msg`) | Level | When |
| --- | --- | --- |
| `send.request.received` | info | First line of the handler; carries `correlationId` only |
| `send.request.completed` | info | Provider accepted the message |
| `send.request.failed` | error | Any error response, including validation and auth failures |

Fields that may appear (only non-`undefined` values are emitted):

| Field | Emitted on | Values |
| --- | --- | --- |
| `correlationId` | every entry | The resolved correlation ID |
| `outcome` | completed / failed | `sent`, `failed`, `validation_error`, `auth_error` |
| `errorCode` | failed | A `PostKitErrorCode` value |
| `durationMs` | completed / failed | Milliseconds from handler entry |
| `tenantId` | completed / failed | Set once the credential resolves; absent on 401/403 and on `STORAGE_FAILURE` |
| `templateKey` | completed / failed | Set once the body validates |
| `environment` | completed / failed | `development`, `staging`, or `production` from the credential; absent on 401/403 and on `STORAGE_FAILURE` |
| `providerMessageId` | completed / failed | Provider-assigned message id on success; provider request id on provider failures when available |
| `failureCategory` | failed | Stable failure bucket — API-level categories (`template_not_found`, `missing_variables`, …) or one of the six provider kinds (`configuration`, `transient`, `rate_limit`, `permanent`, `validation`, `cancelled`) |
| `recipientHash` | completed / failed | 16-character SHA-256 prefix of the normalized recipient address; see [`send-metrics-queries.md`](./send-metrics-queries.md) |

Three additional diagnostic entries are written through the Functions invocation
context rather than the structured logger, so they are searchable by message
text: `app configuration load failed` (error `name` only),
`send provider failed` (`kind`, `statusCode`, `correlationId`), and
`send failed` (error `name`, `correlationId`).

The provider adapter logs its own entries — `email.send.accepted`,
`email.send.failed`, `email.send.development` — with `provider`, `statusCode`,
`providerRequestId`, `correlationId`, and `recipientDomain` (domain only).

**Never log or ask anyone to log** bearer tokens, `TENANT_KEY_MAP` contents,
provider API keys, request bodies, recipient addresses, or variable values. The
tenant resolver deliberately never includes the token in its error messages, and
the logger only emits a fixed set of known keys for exactly this reason.
Recipient correlation uses `recipientHash` (documented in
[`send-metrics-queries.md`](./send-metrics-queries.md)) — never the raw address.

### Example queries

Operational metrics queries (sends per tenant, success rate, provider failures,
latency, duplicate/retry behaviour) live in
[`send-metrics-queries.md`](./send-metrics-queries.md). The examples below cover
single-request tracing and failure breakdown.

Placeholder names only — substitute your own workspace and table names.

Trace one request end to end by correlation ID:

```kusto
traces
| where timestamp > ago(1d)
| extend payload = parse_json(message)
| where tostring(payload.correlationId) == "<correlation-id>"
| project timestamp, msg = tostring(payload.msg), outcome = tostring(payload.outcome),
          errorCode = tostring(payload.errorCode), durationMs = toint(payload.durationMs)
| order by timestamp asc
```

Failure breakdown for one tenant over the last day:

```kusto
traces
| where timestamp > ago(1d)
| extend payload = parse_json(message)
| where tostring(payload.msg) == "send.request.failed"
| where tostring(payload.tenantId) == "<tenant-id>"
| summarize count() by errorCode = tostring(payload.errorCode), bin(timestamp, 1h)
| order by timestamp asc
```

### Correlation IDs for consumers

Consumers should generate their own correlation ID per user action, log it on
their side, and pass it as `x-correlation-id`. That makes a support request
traceable from the consumer application straight through to PostKit and the
provider without any ID mapping step. If the consumer does not send one, capture
the `X-Correlation-Id` response header instead and quote it in the report.

## Scenario runbooks

### Runbook 1 — template not found

Reported as a `404` with `TEMPLATE_NOT_FOUND`.

1. Read `tenantId` and `templateKey` from the `send.request.failed` entry for
   the reported correlation ID.
2. Confirm the environment: the credential — not the request — decides whether
   the lookup targets `development`, `staging`, or `production`. A production
   token will never see a template published only to development.
3. Check the key spelling exactly, including case. Keys are matched literally.
4. Confirm the publish job actually ran, and ran on the branch that publishes
   to that environment.
5. Confirm both blobs exist under
   `tenants/{tenantId}/{environment}/templates/{templateKey}/` —
   `template.html` **and** `metadata.json`. A missing `metadata.json` produces
   the same `404`.
6. If the blobs exist but the call now returns `400 INVALID_TEMPLATE`, the
   artefact is present but malformed — see the corresponding table row.

### Runbook 2 — accepted but not delivered

Reported as "PostKit returned success but nothing arrived".

1. Confirm the send actually reached a provider: find `send.request.completed`
   for the correlation ID and note `providerMessageId`.
2. Check which provider ran. If `EMAIL_PROVIDER` is not `forward-email`, or
   `EMAIL_ALLOW_PRODUCTION_SEND` is not `true`, the development provider is
   selected and **mail is captured in memory and never delivered**. That
   downgrade logs `email.provider.downgraded`, and its message ids start with
   `dev-`.
3. For a real provider send, `200` only means acceptance. Verify sender
   identity and domain configuration — MX, SPF, DKIM, DMARC, Return-Path — per
   [`email-forward-email.md`](../email-forward-email.md).
4. Check the recipient side: spam placement, a corporate gateway, or an
   internal bounce. PostKit receives no bounce signal, so this must be checked
   at the mailbox.
5. Confirm the sender address in use (`EMAIL_FROM_ADDRESS`) is one the
   configured domain is authorised to send as.

### Runbook 3 — sudden failures for one tenant only

1. Group `send.request.failed` by `errorCode` for that `tenantId` and find when
   the failures started.
2. All `403 UNAUTHORIZED`: the token was rotated, removed from
   `TENANT_KEY_MAP`, or the map JSON was edited into an invalid state — an
   unparseable map is treated as empty and fails every tenant, so check whether
   other tenants started failing at the same moment.
3. All `404 TEMPLATE_NOT_FOUND`: most often an environment mismatch — the
   credential's environment changed in the key map, or templates were published
   to the wrong `tenants/{tenantId}/{environment}/` prefix.
4. All `400 INVALID_TEMPLATE` after a release: a publish wrote artefacts with a
   `metadata.json` whose `key` or `schemaVersion` no longer matches.
5. Failures across every tenant at once point at shared configuration instead:
   `STORAGE_FAILURE` (App Configuration) or `PROVIDER_FAILURE` with
   `kind=configuration` (credential resolution).

## What is not observable today

State these limits plainly when reporting back:

- **No delivery-status webhook.** PostKit learns nothing after the provider
  accepts a message. There is no delivered/opened/deferred signal.
- **No bounce handling.** Hard and soft bounces are invisible to PostKit and to
  these logs.
- **No per-tenant send audit surface.** There is no queryable record of what a
  tenant sent beyond the raw log entries, and those carry no recipient (only the
  provider adapter records a recipient *domain*).
- **No delivery retry queue.** A failed send is the caller's to retry.

Gaps that need a new telemetry field or a new surface belong on epic
[#6](https://github.com/singleton-sd/post-kit/issues/6) as a comment — do not
add fields as part of a documentation change.
