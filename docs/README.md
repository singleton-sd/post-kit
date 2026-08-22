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
└── architecture/
    └── overview.md           (phase-1 system shape)
```

## Topic docs

| Doc | Covers |
| --- | --- |
| [`github-source-of-truth.md`](./github-source-of-truth.md) | Engineering system-of-record policy |
| [`github-project.md`](./github-project.md) | PostKit Engineering project fields, views, labels |
| [`pr-pipelines.md`](./pr-pipelines.md) | PR CI, release, secrets policy |
| [`architecture/overview.md`](./architecture/overview.md) | Phase-1 architecture: Functions API, EmailProvider, consumers |
| [`email-forward-email.md`](./email-forward-email.md) | Forward Email provider, DNS, `pnpm email:provision`, Function contact |
