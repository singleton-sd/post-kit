# Template publishing

How authored templates reach a tenant and environment so the PostKit send
endpoint can use them. Authoring the source files is covered in
[`template-authoring.md`](./template-authoring.md).

## Lifecycle

```text
content/email-templates/<key>/   (consumer repo, reviewed via PR)
        │
        │  merge to a publishing branch
        ▼
   consumer CI workflow
        │  azure/login (OIDC)  ->  DefaultAzureCredential
        ▼
   post-kit-publish
        │  compile every template (fail-fast)
        │  upload template.html + metadata.json
        │  optional: --prune retired keys
        ▼
Azure Blob Storage
   tenants/{tenant}/{environment}/templates/{key}/template.html
   tenants/{tenant}/{environment}/templates/{key}/metadata.json
        │
        ▼
   PostKit API (BlobTemplateStore) at send time
```

A copy-pasteable workflow implementing the CI step is in
[`../examples/publish-email-templates.yml`](../examples/publish-email-templates.yml).

## Blob layout

The publisher writes, and the API reads, exactly two blobs per template:

```text
tenants/{tenant}/{environment}/templates/{templateKey}/template.html
tenants/{tenant}/{environment}/templates/{templateKey}/metadata.json
```

`template.html` is uploaded as `text/html; charset=utf-8` and still contains
the `{{variable}}` placeholders; `metadata.json` is uploaded as
`application/json; charset=utf-8` and is the compiled metadata, which the API
re-validates on load. Uploads overwrite whatever is already at those paths.

The compile manifest (including the SHA-256 `contentHash`) is **not** stored as
a blob. It is emitted as one JSON line per template on the publisher's stdout,
which is where CI logs preserve it:

```json
{
  "key": "marketing.contact-us",
  "contentHash": "…",
  "templateHtml": "tenants/acme/production/templates/marketing.contact-us/template.html",
  "metadataJson": "tenants/acme/production/templates/marketing.contact-us/metadata.json"
}
```

## `post-kit-publish`

```bash
pnpm exec post-kit-publish \
  --templates ./content/email-templates \
  --tenant acme \
  --environment production \
  --storage-account <storage-account-name> \
  --container templates \
  --commit "$GITHUB_SHA"
```

Every flag the CLI implements:

| Flag | Required | Meaning and validation |
| --- | --- | --- |
| `--templates <dir>` | yes | Root directory whose subdirectories are templates. Each must contain `template.json`, `metadata.json`, `preview.json`. |
| `--tenant <id>` | yes | Tenant id, used as the `tenants/<id>` path segment. Alphanumeric with internal hyphens only (must start and end alphanumeric); no dots, no slashes, no `..`. |
| `--environment <env>` | yes | Exactly one of `development`, `staging`, `production`. Anything else is rejected. |
| `--storage-account <name>` | yes | Azure Storage account **name** (not a URL, not a connection string). Must match `/^[a-z0-9]{3,24}$/`. The endpoint `https://<name>.blob.core.windows.net` is derived from it. |
| `--container <name>` | yes | Blob container holding the `tenants/…` prefix. |
| `--commit <sha>` | no | Recorded as the compiled manifest's `sourceCommit`. Omitted, it defaults to an empty string. Pass `${{ github.sha }}` in CI so every artifact is traceable to the source revision it was built from. |
| `--dry-run` | no | Compile every template and print the full change set (adds, updates, and — when combined with `--prune` — deletions) as JSON lines on stdout. Performs no uploads and no deletes. Exit 1 if any template fails to compile, same as a normal run. |
| `--prune` | no | After a successful upload pass, delete blobs for template keys that exist in storage under `tenants/{tenant}/{environment}/templates/` but are absent from the compiled set. **Off by default** — a publish of a subset must not remove sibling templates. Each pruned key is reported as one JSON line on stdout with `"action": "delete"`. Scoped strictly to the tenant/environment templates prefix; never deletes outside it. |
| `--help`, `-h` | no | Print usage and exit 2. |

Missing any required flag prints usage and exits 2. Credentials cannot be supplied on the command line.

Exit codes: `0` on success, `1` when any template failed (or an unexpected
error was thrown), `2` for a usage error. Successful runs print a summary line
to stderr; failures print one `FAILED <dir>: <message>` line per failure.

## Fail-fast semantics

Publishing is all-or-nothing per run:

1. The publisher first checks that every subdirectory has all three source
   files. A missing file throws immediately, before any compilation.
2. It then compiles every template. Compile failures and duplicate keys are
   collected rather than thrown.
3. **If any template failed, nothing is uploaded or pruned** — the run returns an
   empty published list and the CLI exits 1.
4. Only when every template compiled cleanly does the upload loop start (and,
   when `--prune` is set, the delete pass after uploads).

Uploads themselves are not transactional: once step 4 begins, a failure
mid-loop leaves earlier templates already written. Re-running a fixed publish
is safe and idempotent, because uploads overwrite by path.

Practical consequence: a single broken template blocks publication of its
siblings. Validate on the pull request (see the compiler script in the
authoring guide) so this never surfaces at publish time.

## Dry run and retiring templates

Use `--dry-run` before a production publish to see what would change without
writing anything:

```bash
pnpm exec post-kit-publish --templates ./content/email-templates \
  --tenant acme --environment production \
  --storage-account <storage-account-name> --container templates \
  --dry-run --prune
```

Stdout receives one JSON line per add, update, or (with `--prune`) delete.
Adds and updates include `contentHash`; deletes use `"action": "delete"`.
Stderr prints a short summary (for example `Dry run: 1 update(s), 1 delete(s)`).

When a template directory is removed from source, its blobs remain in storage
until you publish again **with `--prune`**. Prune is opt-in so a workflow that
publishes only part of the tree cannot silently delete the rest. Only pass
`--prune` when the `--templates` directory is the full authoritative set for
that tenant and environment.

## Environments and promotion

`development`, `staging`, and `production` are separate blob prefixes under the
same tenant. Nothing copies artifacts between them, and there is no promote
command.

Promotion is therefore "run the publisher again against the next environment,
from the same source revision":

```bash
# promote the reviewed commit to production
pnpm exec post-kit-publish --templates ./content/email-templates \
  --tenant acme --environment production \
  --storage-account <storage-account-name> --container templates \
  --commit "$GITHUB_SHA"
```

Guidance:

- Drive the environment from the branch or from a manual workflow input — the
  example workflow publishes `production` from `main` and `development`
  otherwise.
- Publish from the same commit for every environment so the artifacts are
  identical; the `--commit` value recorded in the manifest is how you prove it.
- Environments may live in different storage accounts. Only the account name
  and environment flag change; the path convention does not.
- Tenants are isolated by the `tenants/<tenant>` prefix. Publishing for a
  second tenant is a second run with a different `--tenant`.

At send time the API resolves the tenant and environment from the caller's
credentials and reads from `TEMPLATE_STORAGE_ACCOUNT` /
`TEMPLATE_STORAGE_CONTAINER` (the latter defaults to `templates`). The
container you publish into must be the container the API is configured to read.

## Authentication

The publisher constructs its Blob client with `DefaultAzureCredential` and
**offers no alternative**. There is no connection-string flag, no account-key
flag, and no SAS-token flag — by design.

- **In CI:** authenticate with `azure/login` using **OIDC federated
  credentials**. The login populates the environment that
  `DefaultAzureCredential` reads, so no further configuration is needed. The
  job needs `permissions: id-token: write` and `contents: read`, and passes
  client, tenant, and subscription **IDs** as repository *Variables*.
- **Locally:** `az login`, which `DefaultAzureCredential` also picks up.
- **On Azure compute:** a managed identity is picked up automatically.

Storage account keys and connection strings **must not be used** and must never
be placed in GitHub Secrets, workflow files, or the repository. The only
GitHub-side configuration is the three non-secret IDs
(`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`), consistent
with the secrets policy in [`../pr-pipelines.md`](../pr-pipelines.md). An
`AZURE_CREDENTIALS` secret is explicitly forbidden.

## Publisher RBAC

The publishing identity — the app registration behind the federated credential
— needs data-plane write access to the blobs it publishes. Control-plane roles
such as Owner or Contributor do **not** grant blob data access on their own.

- Grant a **blob data contributor** role (read/write/delete on blob data),
  scoped as narrowly as practical: prefer the specific container over the
  storage account, and the storage account over the resource group.
- Grant it per environment. A workflow that only publishes `development`
  should not hold write access to the production storage account.
- The PostKit API's own identity needs only **blob data reader** on the same
  container — it never writes.
- The federated credential subject must match the GitHub OIDC `sub` claim
  exactly; see the OIDC subject-form note in
  [`../pr-pipelines.md`](../pr-pipelines.md).

## Example workflow

[`../examples/publish-email-templates.yml`](../examples/publish-email-templates.yml)
is sample content for a **consumer repository**. It is documentation: it is not
installed in this repository's `.github/workflows/`. Copy it into your own
repository, replace the placeholder tenant, storage account, and container, and
adjust the environment-selection step to match your branching model.
