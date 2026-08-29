# Documentation map

Repository documentation is the authoritative source for engineering
technical knowledge — architecture, conventions, runbooks, pipelines. See
[`docs/github-source-of-truth.md`](./github-source-of-truth.md) section 1
for the exact system-ownership boundary this follows, and section 7 for what
must never appear here (secrets, customer-private data, pricing, contracts,
commercial roadmap).

This page exists so an implementation agent can find the right doc without
grepping the directory. If you add a new `docs/**` file, add a row here.

## Start here

- New to the system? Read
  [`docs/architecture/overview.md`](./architecture/overview.md) first.
- Engineering lifecycle, agent-ready criteria, and PR linking:
  [`docs/github-source-of-truth.md`](./github-source-of-truth.md).
- Human checklist (GitHub protection, Azure IDs, npm): [`SETUP.md`](../SETUP.md).
- Day-to-day agent workflow: [`AGENTS.md`](../AGENTS.md).

## Structure

```text
docs/
├── README.md                 (this file)
├── github-source-of-truth.md (engineering lifecycle policy)
├── github-project.md         (Project fields, views, labels)
├── pr-pipelines.md           (CI, release, secrets)
├── email-forward-email.md    (Forward Email runtime + provision CLI)
├── architecture/
│   ├── overview.md           (phase-1 system shape)
│   ├── request-lifecycle.md  (POST /emails/send sequence + error codes)
│   ├── template-lifecycle.md (source -> compile -> publish -> Blob -> send)
│   └── multi-tenant-security.md (tenant + environment boundaries)
├── guides/
│   ├── template-authoring.md  (consumer template source files + variables)
│   ├── template-publishing.md (post-kit-publish, blob layout, environments)
│   ├── api-quickstart.md     (send API + client quick start)
│   └── template-publishing.md (post-kit-publish, blob layout, environments)
├── operations/
│   └── troubleshooting.md    (send endpoint triage, correlation IDs, runbooks)
└── examples/
    └── publish-email-templates.yml (sample consumer publish workflow)
```

## Topic docs

| Doc | Covers |
| --- | --- |
| [`github-source-of-truth.md`](./github-source-of-truth.md) | Engineering system-of-record policy |
| [`github-project.md`](./github-project.md) | PostKit Engineering project fields, views, labels |
| [`pr-pipelines.md`](./pr-pipelines.md) | PR CI, release, secrets policy |
| [`architecture/overview.md`](./architecture/overview.md) | Phase-1 architecture: Functions API, EmailProvider, consumers |
| [`email-forward-email.md`](./email-forward-email.md) | Forward Email provider, DNS, `pnpm email:provision`, Function contact, branding CI |
| [`guides/api-quickstart.md`](./guides/api-quickstart.md) | `POST /emails/send` contract, `PostKitClient` usage, error taxonomy and retries |
| [`guides/template-authoring.md`](./guides/template-authoring.md) | Consumer template layout, `metadata.json` fields, template keys, variables, local validation |
| [`guides/template-publishing.md`](./guides/template-publishing.md) | `post-kit-publish` flags, blob layout, fail-fast, per-environment promotion, OIDC + RBAC |
| [`examples/publish-email-templates.yml`](./examples/publish-email-templates.yml) | Sample consumer-repository publish workflow (not installed in this repo) |
| [`architecture/request-lifecycle.md`](./architecture/request-lifecycle.md) | `POST /emails/send` runtime sequence, correlation IDs, error-code → HTTP-status table |
| [`architecture/template-lifecycle.md`](./architecture/template-lifecycle.md) | Template source → compiler → publisher → Blob layout → send-time load |
| [`architecture/multi-tenant-security.md`](./architecture/multi-tenant-security.md) | Tenant resolution, environment separation, path safety, credential boundaries, unimplemented controls |
| [`operations/troubleshooting.md`](./operations/troubleshooting.md) | `POST /emails/send` error triage, correlation-ID tracing, incident runbooks |
