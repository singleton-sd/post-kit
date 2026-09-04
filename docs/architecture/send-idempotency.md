# Send idempotency

How `POST /emails/send` avoids double-sends when a consumer retries with the
same `Idempotency-Key`.

See also [`request-lifecycle.md`](./request-lifecycle.md).

## Contract

| Header | Required | Behaviour |
| --- | --- | --- |
| `Idempotency-Key` | No | When **absent**, behaviour is unchanged (at-least-once). When **present**, the key is validated, then used as a per-tenant claim before the provider is called. |

- Scope: `{tenantId, environment}` + key. The same key from two tenants (or two
  environments of the same tenant id) are independent.
- Replay of a **completed** request returns the original `SendResponse` and does
  **not** call the email provider again.
- Replay while the first request is still **in flight** returns HTTP `409` with
  `PostKitErrorCode.IDEMPOTENCY_IN_PROGRESS`.
- Unsafe or oversized keys are rejected with HTTP `400` **before** any storage
  access (`1–128` characters of `[A-Za-z0-9._:~-]`).

This issue does **not** implement automatic retries; it only makes client
retries safe. Automatic retry policy is a separate concern.

## Persistence choice: Azure Blob (not Table)

| Option | Pros | Cons |
| --- | --- | --- |
| **Azure Blob** (chosen) | Already used by the API (`@azure/storage-blob`, `DefaultAzureCredential`); conditional create via `If-None-Match: *`; no new dependency / lockfile churn; JSON payload fits the small record shape | No native TTL — expiry is checked on read; optional lifecycle rules reclaim bytes |
| Azure Table | Cheap entity store; partition+row key maps cleanly to tenant+key | New `@azure/data-tables` dependency; another client/credential surface for the same storage account |

**Decision:** store one JSON blob per claim in a dedicated container (default
`idempotency`) on the same storage account as templates
(`IDEMPOTENCY_STORAGE_ACCOUNT` falls back to `TEMPLATE_STORAGE_ACCOUNT`).

Blob path:

```text
tenants/{tenantId}/{environment}/idempotency/{sha256(key)}.json
```

The consumer key is hashed so the blob name stays path-safe; the original key
is still stored inside the JSON for debugging (it is not a secret, but never
log it next to recipient data).

### Record shape

Stored fields only:

| Field | Purpose |
| --- | --- |
| `key` | Validated consumer key |
| `tenantId` / `environment` | Tenant scope |
| `status` | `in_progress` \| `completed` |
| `response` | Original `SendResponse` when completed |
| `createdAt` / `expiresAt` | Timestamps + TTL |

**Never stored:** recipients, variables, rendered HTML/subject, tokens.

### TTL / expiry

Default TTL: **24 hours** (`IDEMPOTENCY_TTL_MS`, default `86400000`).

On `begin`, expired records are treated as absent and may be overwritten. Blob
lifecycle management on the `idempotency` container can delete old objects for
cost control; application correctness does not depend on that delete happening
immediately.

### Claim flow

```text
1. Validate Idempotency-Key (reject → 400)
2. Conditional create blob status=in_progress (If-None-Match: *)
   - created → claim held; continue to provider.send
   - conflict → read existing
       - completed + fresh → return stored SendResponse (200)
       - in_progress + fresh → 409 IDEMPOTENCY_IN_PROGRESS
       - expired → overwrite and claim
3. On provider success → overwrite blob status=completed + response
4. On provider failure → delete in-progress blob (release) so the same key may retry
```

## Configuration

| Env | Default | Notes |
| --- | --- | --- |
| `IDEMPOTENCY_STORAGE_ACCOUNT` | `TEMPLATE_STORAGE_ACCOUNT` | Storage account name |
| `IDEMPOTENCY_STORAGE_CONTAINER` | `idempotency` | Dedicated container |
| `IDEMPOTENCY_TTL_MS` | `86400000` (24h) | Soft expiry checked on read |
