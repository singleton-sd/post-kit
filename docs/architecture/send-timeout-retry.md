# Send timeouts, failure classification, and safe retry

How `POST /emails/send` bounds provider latency, classifies failures, and
retries only when an `Idempotency-Key` makes it safe.

See also [`send-idempotency.md`](./send-idempotency.md) and
[`request-lifecycle.md`](./request-lifecycle.md).

## Relationship to the Function App limit

PostKit runs on Azure Functions **Consumption (Y1)**. The default function
execution limit is **5 minutes** (`300_000` ms). Each provider attempt is
bounded by `SEND_PROVIDER_TIMEOUT_MS` (default **15 s**), and the total
worst-case retry budget (attempts × timeout + backoff) is clamped so it stays
under that limit minus headroom for auth, template load, render, and
idempotency I/O (~60 s).

Operators can override `FUNCTION_TIMEOUT_MS` in docs/tests to match a custom
`host.json` `functionTimeout`; the policy resolver clamps both
`SEND_PROVIDER_TIMEOUT_MS` and `SEND_MAX_ATTEMPTS` so a single attempt and the
retry budget stay inside the usable window (`functionTimeout − headroom`).

## Timeouts

Every `provider.send` call is raced against an independent timer
(`SEND_PROVIDER_TIMEOUT_MS`) that also aborts the `AbortSignal`. A timeout
always yields the typed `SendTimeoutError` (never a hung invocation), even if
an injected provider ignores abort, and is logged as:

| Field | Value |
| --- | --- |
| `failureCategory` | `timeout` |
| `failureClass` | `transient` |
| HTTP | `503` `PROVIDER_FAILURE` |

The Forward Email adapter may also enforce its own per-request timeout; the
send path disables provider-internal retries (`maxRetries: 0`) so retry policy
lives only here.

## Failure classification

Provider outcomes map to a small, stable set exposed on the **internal
delivery result** and structured logs — not as provider-specific public DTOs:

| Class | Typical causes | `failureCategory` examples |
| --- | --- | --- |
| **transient** | Network error, timeout, provider `5xx`, throttling (`429`) | `transient`, `timeout`, `rate_limit` |
| **permanent** | Invalid recipient, rejected sender, auth failure, provider `4xx`, validation, misconfiguration, cancellation | `permanent`, `validation`, `configuration`, `cancelled` |

`EmailProviderError.kind` remains the source for provider adapters;
`failureClass` is the send-path summary used for retry decisions and ops.

## Retry (idempotency-gated)

| Condition | Behaviour |
| --- | --- |
| No `Idempotency-Key` | **Single** provider attempt (at-least-once). Caller retries may double-send. |
| `Idempotency-Key` claim held | **Clear** HTTP transient failures only — `EmailProviderError` with a `statusCode` (`5xx` / `429`) and `retryable: true` — up to `SEND_MAX_ATTEMPTS` with exponential backoff (`SEND_RETRY_BASE_DELAY_MS`, capped at 2 s). |
| Timeout / transport drop (no HTTP status) | Classified **transient** for HTTP (`503`) but **not** retried internally — the provider may already have accepted, and Forward Email has no provider-level idempotency key. |
| Permanent failure | No retry. Claim is released so the same key may be reused after the caller fixes the request. |

Retries **reuse the in-progress idempotency claim** — the ledger is not
released between attempts, so a parallel request with the same key still gets
`409 IDEMPOTENCY_IN_PROGRESS` and cannot start a second delivery.

On final failure the claim is released. On success the claim is completed
exactly as in [`send-idempotency.md`](./send-idempotency.md); a later replay
returns the stored `SendResponse` without calling the provider again.

## Caller retries vs internal retries

| Who | When | Safe? |
| --- | --- | --- |
| **Internal** (this policy) | HTTP `5xx` / `429` with Idempotency-Key claim | Best-effort: a status response means the provider rejected/throttled that attempt. Still at-least-once if a provider lies or accepts then returns 5xx. |
| **Internal** on timeout or transport drop | Never | Avoids a second provider POST after an ambiguous outcome |
| **Caller** with same `Idempotency-Key` | After `503` / timeout / network | Replay or re-claim after release; completed keys never re-send. After a timeout, a caller retry may still double-deliver at the provider (same ambiguity). |
| **Caller** without `Idempotency-Key` | Any retry after uncertainty | **Not safe** — may deliver twice |
| **Caller** after `502` permanent | Same payload | No — fix the request; retrying will fail the same way |

Guidance for consumers: always send an `Idempotency-Key` for user-visible or
payment-adjacent mail, and on timeout/`503` retry the **same** key. Do not mint
a new key for the same logical send. Treat timeout retries as at-least-once
until a provider-native idempotency mechanism exists.

## Configuration

| Env | Default | Notes |
| --- | --- | --- |
| `SEND_PROVIDER_TIMEOUT_MS` | `15000` | Per-attempt abort |
| `SEND_MAX_ATTEMPTS` | `3` | Used only when an idempotency claim is held; clamped to fit the function budget |
| `SEND_RETRY_BASE_DELAY_MS` | `250` | Exponential backoff base; delay capped at 2000 ms |
| `FUNCTION_TIMEOUT_MS` | `300000` | Documented Consumption default; used for budget clamping |

App Configuration keys (explicit env still wins):

- `app:email:sendProviderTimeoutMs` → `SEND_PROVIDER_TIMEOUT_MS`
- `app:email:sendMaxAttempts` → `SEND_MAX_ATTEMPTS`
- `app:email:sendRetryBaseDelayMs` → `SEND_RETRY_BASE_DELAY_MS`
