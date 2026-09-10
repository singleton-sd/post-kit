# Infra

Bicep for the PostKit Function App, App Configuration store, and Key Vault in
**`rg-postkit-prod-ae`** on the dedicated PostKit subscription
(**name** `ssd-post-kit`; **subscription ID** TBD — see
[`SETUP.md`](../SETUP.md) §5 and [#116](https://github.com/singleton-sd/post-kit/issues/116)).

Do **not** invent a subscription GUID. Until a human pastes the ID on #116 and
sets GitHub Variable `AZURE_SUBSCRIPTION_ID`, deploy workflows skip Azure steps.

| Resource | Name | SKU |
| --- | --- | --- |
| Plan | `ssd-postkit-plan-prod-ae` | Y1 Linux Consumption |
| Storage | `ssdpostkitstprodae` | Standard_LRS |
| Function App | `ssd-postkit-api-prod-ae` | Node 22 |
| App Configuration | `ssd-postkit-appcs-prod-ae` | **Free** (3 stores/region/sub; 1,000 req/day; 10 MB) |
| Key Vault | `ssd-postkit-kv-prod-ae` | Standard, RBAC; secrets `forwardemail-api-key`, `recipient-hash-hmac-key` |

## Leaving `rg-ssd-global` (cutover)

Historical target was Singleton SD / `rg-ssd-global` /
`ssd-global-kv-prod-ae`. After the dedicated subscription exists:

1. Create `rg-postkit-prod-ae` in `ssd-post-kit` (Australia East).
2. Deploy this bicep into that RG (creates plan, storage, Function App, Free
   App Config, and preferred Key Vault).
3. Copy secret **values** into the new vault (names unchanged).
4. Point GitHub `AZURE_SUBSCRIPTION_ID` at the new sub; keep tenant ID
   `9a0e57d7-e58e-4e8b-814d-037cd7d9015c`.
5. Do not continue provisioning PostKit resources into `rg-ssd-global`.

**Fallback (existing vault in this RG):** Azure Key Vault names are globally
unique. Do **not** pass `keyVaultName=ssd-global-kv-prod-ae` (or any other
already-used name) with the default `createKeyVault=true` — deployment would
try to create that vault and fail. To reference a vault that already exists
**in the same resource group**:

```bash
az deployment group create ... \
  --parameters createKeyVault=false keyVaultName=<existing-vault-in-this-rg>
```

**Cross-subscription shared vault** (`ssd-global-kv-prod-ae` on Singleton SD):
out of scope for this template (Bicep cannot assign roles on another
subscription’s vault from an RG deployment without a separate module). Grant
Key Vault Secrets User + App Config Key Vault references manually; prefer the
dedicated vault.

Non-secret settings (public API base URL, origins, host profiles, branding
validation, from/inbox) live in App Configuration. `infra/appconfig-seed.json`
is first-run only — `scripts/seed-appconfig.sh` does **not** overwrite keys that
already exist, so ops can edit in the portal. The Forward Email token is a Key
Vault reference (`secret:forwardemail-api-key`), not a value in the store.

The Function App only needs `AZURE_APPCONFIGURATION_ENDPOINT` plus host
plumbing. It loads keys at request time via managed identity.

Deploy is `.github/workflows/deploy-api.yml` (OIDC). If GitHub Variables are
missing, the workflow skips Azure steps so CI is not blocked.

Do not put tokens in git or GitHub Secrets.
