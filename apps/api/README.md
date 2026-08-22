# `@singleton-sd/post-kit-api`

Azure Functions (anonymous contact + health). Trusted marketing sites POST
`/contact` with an allowlisted `Origin`. Host-specific sender/inbox and other
non-secret settings come from Azure App Configuration
(`ssd-postkit-appcs-prod-ae`). `FORWARD_EMAIL_TOKEN` is a Key Vault reference
in that store.

Local `func start` needs `az login` and
`AZURE_APPCONFIGURATION_ENDPOINT` in `local.settings.json` (see the example).
Do not put tenant profiles or tokens in `local.settings.json`.

```bash
pnpm --filter @singleton-sd/post-kit-api test
pnpm --filter @singleton-sd/post-kit-api start
```

See [`docs/email-forward-email.md`](../../docs/email-forward-email.md) and
[`infra/README.md`](../../infra/README.md).
