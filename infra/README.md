# Infra

Bicep for the PostKit Function App in `rg-ssd-global` (subscription
`01c0bb8b-3770-4765-979a-cb13ae7e3dd2`).

| Resource | Name | SKU |
| --- | --- | --- |
| Plan | `ssd-postkit-plan-prod-ae` | Y1 Linux Consumption |
| Storage | `ssdpostkitstprodae` | Standard_LRS |
| Function App | `ssd-postkit-api-prod-ae` | Node 24 |
| Key Vault | existing `ssd-global-kv-prod-ae` | secret `forwardemail-api-key` |

`CONTACT_EMAIL_PROFILES_BY_HOST` is an app setting (JSON). Update the
`contactEmailProfilesByHost` parameter when onboarding a PoC host.

Deploy is `.github/workflows/deploy-api.yml` (OIDC). If GitHub Variables are
missing, the workflow skips Azure steps so CI is not blocked.

Do not put tokens in git or GitHub Secrets.
