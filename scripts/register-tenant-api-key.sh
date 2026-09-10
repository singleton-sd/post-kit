#!/usr/bin/env bash
# Register (or rotate) a PostKit consumer API key in TENANT_KEY_MAP.
#
# Generates a random Bearer token, merges it into the Key Vault secret
# `tenant-key-map`, and ensures the Function App setting TENANT_KEY_MAP is a
# Key Vault reference (not plain text / App Configuration).
#
# Usage:
#   ./scripts/register-tenant-api-key.sh --tenant-id inkads --environment production
#   ./scripts/register-tenant-api-key.sh --tenant-id acme --environment development --dry-run
#   ./scripts/register-tenant-api-key.sh --tenant-id inkads --environment production --token 'tk_live_...'
#
# The new token is printed once to stdout (for the operator to copy into the
# consumer secret store). It is never written to git.
#
# Concurrency: read-modify-write on a single Key Vault secret. Do not run this
# script concurrently across operators or hosts — serialize registrations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$SCRIPT_DIR/tenant-key-map.mjs"

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-9b6fc2b1-064a-4eb2-81fe-0aa8c7c751b5}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-postkit-prod-ae}"
FUNCTION_APP="${AZURE_FUNCTION_APP_NAME:-ssd-postkit-api-prod-ae}"
VAULT_NAME="${AZURE_KEY_VAULT_NAME:-ssd-postkit-kv-prod-ae}"
SECRET_NAME="${TENANT_KEY_MAP_SECRET_NAME:-tenant-key-map}"
TENANT_ID=""
ENVIRONMENT=""
TOKEN=""
DRY_RUN=0
RAW_FILE=""
SHOW_ERR=""
MAP_FILE=""

cleanup() {
  rm -f "${RAW_FILE:-}" "${SHOW_ERR:-}" "${MAP_FILE:-}"
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Register a PostKit tenant API key in Key Vault TENANT_KEY_MAP.

Required:
  --tenant-id <id>              Tenant id (e.g. inkads)
  --environment <env>           development | staging | production

Optional:
  --token <token>               Bring-your-own token (min 16 chars); default: random
  --dry-run                     Print actions; do not call Azure
  --subscription <guid>         Default: SSD Post Kit subscription
  --resource-group <name>       Default: rg-postkit-prod-ae
  --function-app <name>         Default: ssd-postkit-api-prod-ae
  --vault <name>                Default: ssd-postkit-kv-prod-ae
  --secret-name <name>          Default: tenant-key-map

Also accepted via env: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP,
AZURE_FUNCTION_APP_NAME, AZURE_KEY_VAULT_NAME, TENANT_KEY_MAP_SECRET_NAME.

Do not run concurrent registrations; serialize operator runs (single secret RMW).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)
      TENANT_ID="${2:-}"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --subscription)
      SUBSCRIPTION_ID="${2:-}"
      shift 2
      ;;
    --resource-group)
      RESOURCE_GROUP="${2:-}"
      shift 2
      ;;
    --function-app)
      FUNCTION_APP="${2:-}"
      shift 2
      ;;
    --vault)
      VAULT_NAME="${2:-}"
      shift 2
      ;;
    --secret-name)
      SECRET_NAME="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TENANT_ID" || -z "$ENVIRONMENT" ]]; then
  echo "error: --tenant-id and --environment are required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$HELPER" ]]; then
  echo "error: helper not found: $HELPER" >&2
  exit 1
fi

command -v az >/dev/null || {
  echo "error: az CLI is required" >&2
  exit 1
}
command -v node >/dev/null || {
  echo "error: node is required" >&2
  exit 1
}
command -v python3 >/dev/null || {
  echo "error: python3 is required" >&2
  exit 1
}

EXISTING_JSON=""
if [[ "$DRY_RUN" -eq 0 ]]; then
  az account set --subscription "$SUBSCRIPTION_ID" >/dev/null
  RAW_FILE="$(mktemp)"
  SHOW_ERR="$(mktemp)"
  chmod 600 "$RAW_FILE" "$SHOW_ERR"
  if az keyvault secret show --vault-name "$VAULT_NAME" --name "$SECRET_NAME" --query value -o tsv \
    >"$RAW_FILE" 2>"$SHOW_ERR"; then
    EXISTING_JSON="$(cat "$RAW_FILE")"
  else
    if grep -qiE 'SecretNotFound|was not found' "$SHOW_ERR"; then
      EXISTING_JSON=""
    else
      cat "$SHOW_ERR" >&2
      echo "error: failed to read Key Vault secret $VAULT_NAME/$SECRET_NAME" >&2
      exit 1
    fi
  fi
  rm -f "$RAW_FILE" "$SHOW_ERR"
  RAW_FILE=""
  SHOW_ERR=""
else
  echo "dry-run: skip reading existing secret from $VAULT_NAME/$SECRET_NAME" >&2
fi

MERGE_ARGS=(merge --tenant-id "$TENANT_ID" --environment "$ENVIRONMENT")
if [[ -n "$TOKEN" ]]; then
  MERGE_ARGS+=(--token "$TOKEN")
fi

MERGE_OUT="$(printf '%s' "$EXISTING_JSON" | node "$HELPER" "${MERGE_ARGS[@]}")"
NEW_TOKEN="$(printf '%s' "$MERGE_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
MAP_JSON="$(printf '%s' "$MERGE_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mapJson"])')"
REPLACED="$(printf '%s' "$MERGE_OUT" | python3 -c 'import json,sys; print("true" if json.load(sys.stdin)["replaced"] else "false")')"
KV_REF="$(node "$HELPER" kv-ref --vault "$VAULT_NAME" --secret "$SECRET_NAME")"

echo "tenantId=$TENANT_ID environment=$ENVIRONMENT replaced=$REPLACED" >&2
echo "vault=$VAULT_NAME secret=$SECRET_NAME" >&2
echo "functionApp=$FUNCTION_APP resourceGroup=$RESOURCE_GROUP" >&2

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry-run: would set Key Vault secret $SECRET_NAME (map entry count not printed)" >&2
  echo "dry-run: would set Function App setting TENANT_KEY_MAP=$KV_REF" >&2
  echo "$NEW_TOKEN"
  exit 0
fi

# Write map via a temp file so the value never appears in `ps` argv.
MAP_FILE="$(mktemp)"
chmod 600 "$MAP_FILE"
printf '%s' "$MAP_JSON" >"$MAP_FILE"

az keyvault secret set \
  --vault-name "$VAULT_NAME" \
  --name "$SECRET_NAME" \
  --file "$MAP_FILE" \
  --output none

az functionapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --settings "TENANT_KEY_MAP=$KV_REF" \
  --output none

echo "Stored map in Key Vault and wired Function App Key Vault reference." >&2
echo "Copy the token below into the consumer secret store (shown once):" >&2
echo "$NEW_TOKEN"

# Unset locals that held JSON (best-effort; bash cannot guarantee scrubbing).
EXISTING_JSON=""
MAP_JSON=""
MERGE_OUT=""
