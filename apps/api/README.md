# `@singleton-sd/post-kit-api`

Azure Functions (anonymous contact + health). Trusted marketing sites POST
`/contact` with an allowlisted `Origin`. Host-specific sender/inbox and other
non-secret settings come from Azure App Configuration
(`ssd-postkit-appcs-prod-ae`). `FORWARD_EMAIL_TOKEN` and
`RECIPIENT_HASH_HMAC_KEY` are Key Vault references in that store
(`forwardemail-api-key`, `recipient-hash-hmac-key`).

Local `func start` needs `az login`,
`AZURE_APPCONFIGURATION_ENDPOINT` in `local.settings.json` (see the example),
and these Azure RBAC roles on your user:

- **App Configuration Data Reader** on `ssd-postkit-appcs-prod-ae`
- **Key Vault Secrets User** on `ssd-postkit-kv-prod-ae`

`az login` only supplies a credential; without both roles the contact handler
cannot load configuration. Do not put tenant profiles or tokens in
`local.settings.json`.

```bash
pnpm --filter @singleton-sd/post-kit-api test
pnpm --filter @singleton-sd/post-kit-api start
```

MCP (`POST /mcp`): see [`docs/guides/mcp.md`](../../docs/guides/mcp.md).

See [`docs/email-forward-email.md`](../../docs/email-forward-email.md),
[`docs/integrations/inkads-marketing.md`](../../docs/integrations/inkads-marketing.md),
and [`infra/README.md`](../../infra/README.md).
