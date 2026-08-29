# Send endpoint — operational metrics queries

Copy-pasteable Kusto queries for day-to-day operational questions about
`POST /emails/send`. All queries assume newline-delimited JSON log entries
emitted by `apps/api/src/telemetry/logger.ts` and parsed from the `message`
column in Application Insights `traces`.

**Field contract** (terminal events `send.request.completed` and
`send.request.failed`):

| Field | Description |
| --- | --- |
| `correlationId` | Per-request trace id |
| `tenantId` | Resolved tenant (absent on auth failures before resolution) |
| `environment` | `development`, `staging`, or `production` from the credential |
| `templateKey` | Requested template key (absent when body validation fails early) |
| `outcome` | `sent`, `failed`, `validation_error`, or `auth_error` |
| `durationMs` | Handler wall time in milliseconds |
| `providerMessageId` | Provider-assigned message or request id when available |
| `failureCategory` | Stable failure bucket (see below) |
| `recipientHash` | 16-char SHA-256 prefix of normalized recipient (never the raw address) |
| `errorCode` | `PostKitErrorCode` on failures |

`failureCategory` values for API-level failures:
`auth_unauthenticated`, `auth_unauthorized`, `invalid_template`,
`invalid_recipient`, `missing_variables`, `template_not_found`,
`storage_failure`, `provider_not_configured`, `provider_failure`,
`unhandled`.

Provider failures use the six `EmailProviderError` kinds directly:
`configuration`, `transient`, `rate_limit`, `permanent`, `validation`,
`cancelled`.

For triage runbooks and error-code mapping, see
[`troubleshooting.md`](./troubleshooting.md).

## Setup helper

Every query below uses this parse step. Adjust the time range as needed.

```kusto
let SendEvents = traces
| where timestamp > ago(7d)
| extend payload = parse_json(message)
| where tostring(payload.msg) in ("send.request.completed", "send.request.failed");
```

## Sends per tenant and template

```kusto
SendEvents
| summarize sendCount = count() by
    tenantId = tostring(payload.tenantId),
    templateKey = tostring(payload.templateKey),
    environment = tostring(payload.environment)
| order by sendCount desc
```

## Success and failure rate

```kusto
SendEvents
| extend outcome = tostring(payload.outcome)
| summarize
    total = count(),
    sent = countif(outcome == "sent"),
    failed = countif(outcome != "sent")
| extend successRate = 100.0 * sent / total, failureRate = 100.0 * failed / total
```

Per tenant over time:

```kusto
SendEvents
| extend outcome = tostring(payload.outcome)
| summarize
    total = count(),
    sent = countif(outcome == "sent")
    by tenantId = tostring(payload.tenantId), bin(timestamp, 1h)
| extend successRate = 100.0 * sent / total
| order by timestamp asc
```

## Provider failures

All terminal failures where the provider rejected or could not deliver:

```kusto
SendEvents
| where tostring(payload.msg) == "send.request.failed"
| where tostring(payload.errorCode) == "PROVIDER_FAILURE"
| extend failureCategory = tostring(payload.failureCategory)
| summarize count() by failureCategory, bin(timestamp, 1h)
| order by timestamp asc
```

Provider-kind breakdown (the six `EmailProviderError` kinds):

```kusto
SendEvents
| where tostring(payload.msg) == "send.request.failed"
| where tostring(payload.failureCategory) in (
    "configuration", "transient", "rate_limit", "permanent", "validation", "cancelled")
| summarize count() by failureCategory = tostring(payload.failureCategory)
```

## Template not found

```kusto
SendEvents
| where tostring(payload.msg) == "send.request.failed"
| where tostring(payload.failureCategory) == "template_not_found"
| project timestamp,
    correlationId = tostring(payload.correlationId),
    tenantId = tostring(payload.tenantId),
    environment = tostring(payload.environment),
    templateKey = tostring(payload.templateKey)
| order by timestamp desc
```

## Validation failures

```kusto
SendEvents
| where tostring(payload.outcome) == "validation_error"
| summarize count() by
    failureCategory = tostring(payload.failureCategory),
    errorCode = tostring(payload.errorCode),
    bin(timestamp, 1h)
| order by timestamp asc
```

## Latency distribution

Successful sends:

```kusto
SendEvents
| where tostring(payload.msg) == "send.request.completed"
| extend durationMs = toint(payload.durationMs)
| summarize
    p50 = percentile(durationMs, 50),
    p90 = percentile(durationMs, 90),
    p99 = percentile(durationMs, 99),
    avg = avg(durationMs),
    max = max(durationMs)
    by tenantId = tostring(payload.tenantId)
```

All terminal events (includes failures):

```kusto
SendEvents
| extend durationMs = toint(payload.durationMs)
| summarize percentiles(durationMs, 50, 90, 99) by tostring(payload.msg)
```

## Duplicate and retry behaviour

Correlate retries by the caller-supplied correlation id (same id retried by
the consumer):

```kusto
SendEvents
| summarize attempts = count() by correlationId = tostring(payload.correlationId)
| where attempts > 1
| order by attempts desc
```

Detect duplicate sends to the same recipient within a window (uses
`recipientHash`, not the raw address):

```kusto
SendEvents
| where tostring(payload.msg) == "send.request.completed"
| extend recipientHash = tostring(payload.recipientHash)
| where isnotempty(recipientHash)
| summarize sendCount = count(), correlationIds = make_set(tostring(payload.correlationId), 10)
    by recipientHash, templateKey = tostring(payload.templateKey), bin(timestamp, 1h)
| where sendCount > 1
| order by sendCount desc
```

Join handler logs to provider adapter logs on `correlationId`:

```kusto
traces
| where timestamp > ago(1d)
| extend payload = parse_json(message)
| where tostring(payload.correlationId) == "<correlation-id>"
| project timestamp, msg = tostring(payload.msg), outcome = tostring(payload.outcome),
    failureCategory = tostring(payload.failureCategory),
    providerMessageId = tostring(payload.providerMessageId),
    durationMs = toint(payload.durationMs)
| order by timestamp asc
```
