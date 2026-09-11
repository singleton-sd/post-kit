# Infra

Bicep for the PostKit Function App, App Configuration store, and Key Vault in
**`rg-postkit-prod-ae`** on the dedicated PostKit subscription
(**display name** `SSD Post Kit`; docs short name `ssd-post-kit`;
**ID** `9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5` — see [`SETUP.md`](../SETUP.md)
§5 and [#120](https://github.com/singleton-sd/post-kit/issues/120)).

GitHub Variables `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`
must be set for Deploy API to run Azure steps.

| Resource | Name | SKU |
| --- | --- | --- |
| Plan | `ssd-postkit-plan-prod-ae` | Y1 Linux Consumption |
| Storage | `ssdpostkitstprodae` | Standard_LRS |
| Function App | `ssd-postkit-api-prod-ae` | Node 22 |
| App Configuration | `ssd-postkit-appcs-prod-ae` | **Free** (3 stores/region/sub; 1,000 req/day; 10 MB) |
| Key Vault | `ssd-postkit-kv-prod-ae` | Standard, RBAC; secrets `forwardemail-api-key`, `recipient-hash-hmac-key` |

## Leaving `rg-ssd-global` (cutover — done)

Historical target was Singleton SD / `rg-ssd-global` /
`ssd-global-kv-prod-ae`. PostKit now runs on **SSD Post Kit** /
`rg-postkit-prod-ae` / `ssd-postkit-kv-prod-ae`. Do not provision new PostKit
resources into `rg-ssd-global`.

**Same-RG existing vault only:** Azure Key Vault names are globally unique.
Do **not** pass an already-used vault name with `createKeyVault=true`. To
reference a vault that already exists **in this resource group**:

```bash
az deployment group create ... \
  --parameters createKeyVault=false keyVaultName=<existing-vault-in-this-rg>
```

Cross-subscription shared vaults are out of scope for this template.

Non-secret settings (public API base URL, origins, host profiles, branding
validation, from/inbox) live in App Configuration. `infra/appconfig-seed.json`
is first-run only — `scripts/seed-appconfig.sh` does **not** overwrite keys that
already exist, so ops can edit in the portal. The Forward Email token is a Key
Vault reference (`secret:forwardemail-api-key`), not a value in the store.

After seed, Deploy API runs
`scripts/sync-function-cors-from-appconfig.sh` so Function App **platform CORS**
matches App Config (exact ORIGINS hosts + `profilesByHost` keys). Local:
`pnpm cors:sync`.

The Function App only needs `AZURE_APPCONFIGURATION_ENDPOINT` plus host
plumbing. It loads keys at request time via managed identity.

Deploy is `.github/workflows/deploy-api.yml` (OIDC). If GitHub Variables are
missing, the workflow skips Azure steps so CI is not blocked.

Do not put tokens in git or GitHub Secrets.
