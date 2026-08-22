# Infra

Bicep for the PostKit Function App and App Configuration store in
`rg-ssd-global` (subscription `01c0bb8b-3770-4765-979a-cb13ae7e3dd2`).

| Resource | Name | SKU |
| --- | --- | --- |
| Plan | `ssd-postkit-plan-prod-ae` | Y1 Linux Consumption |
| Storage | `ssdpostkitstprodae` | Standard_LRS |
| Function App | `ssd-postkit-api-prod-ae` | Node 22 |
| App Configuration | `ssd-postkit-appcs-prod-ae` | **Free** |
| Key Vault | existing `ssd-global-kv-prod-ae` | secret `forwardemail-api-key` |

Non-secret settings (origins, host profiles, branding validation, from/inbox)
live in App Configuration. `infra/appconfig-seed.json` is first-run only —
`scripts/seed-appconfig.sh` does **not** overwrite keys that already exist, so
ops can edit in the portal. The Forward Email token is a Key Vault reference
(`secret:forwardemail-api-key`), not a value in the store.

The Function App only needs `AZURE_APPCONFIGURATION_ENDPOINT` plus host
plumbing. It loads keys at request time via managed identity.

Deploy is `.github/workflows/deploy-api.yml` (OIDC). If GitHub Variables are
missing, the workflow skips Azure steps so CI is not blocked.

Do not put tokens in git or GitHub Secrets.
