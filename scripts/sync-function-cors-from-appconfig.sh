#!/usr/bin/env bash
# Sync Function App platform CORS from App Configuration.
#
# Linux Consumption answers OPTIONS at the platform. App Config ORIGINS alone
# does not fix browser preflight — this script pushes exact origin URLs derived
# from App Config onto the Function App.
#
# Derivation (see scripts/platform-cors-origins.mjs):
#   - exact (non-glob) entries in app:email:origins
#   - every host key in app:email:profilesByHost
#   - localhost* → http://… ; other hosts → https://…
#
# Usage:
#   ./scripts/sync-function-cors-from-appconfig.sh
#   ./scripts/sync-function-cors-from-appconfig.sh --dry-run
#   ./scripts/sync-function-cors-from-appconfig.sh --from-seed infra/appconfig-seed.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${APP_CONFIG_NAME:-ssd-postkit-appcs-prod-ae}"
RG="${AZURE_RESOURCE_GROUP:-rg-postkit-prod-ae}"
APP="${AZURE_FUNCTIONAPP_NAME:-ssd-postkit-api-prod-ae}"
DRY_RUN=0
SEED=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --from-seed)
      SEED="${2:-}"
      [[ -n "$SEED" ]] || { echo "error: --from-seed requires a path" >&2; exit 1; }
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$SEED" ]]; then
  [[ -f "$SEED" ]] || { echo "error: seed file not found: $SEED" >&2; exit 1; }
  ORIGINS_RAW="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("app:email:origins",""))' "$SEED")"
  PROFILES_RAW="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("app:email:profilesByHost",""))' "$SEED")"
  echo "source=seed file=$SEED"
else
  ORIGINS_RAW="$(az appconfig kv show --name "$STORE" --key app:email:origins --query value -o tsv)"
  PROFILES_RAW="$(az appconfig kv show --name "$STORE" --key app:email:profilesByHost --query value -o tsv)"
  echo "source=appconfig store=$STORE"
fi

DESIRED_JSON="$(
  cd "$ROOT"
  ORIGINS_RAW="$ORIGINS_RAW" PROFILES_RAW="$PROFILES_RAW" node --input-type=module <<'EOF'
import { platformCorsOriginsFromAppConfig } from './scripts/platform-cors-origins.mjs';
const origins = platformCorsOriginsFromAppConfig({
  originsRaw: process.env.ORIGINS_RAW,
  profilesByHostRaw: process.env.PROFILES_RAW,
});
process.stdout.write(JSON.stringify(origins));
EOF
)"

echo "desired=$DESIRED_JSON"

CURRENT_JSON="$(az functionapp cors show --name "$APP" --resource-group "$RG" --query allowedOrigins -o json 2>/dev/null || echo '[]')"
echo "current=$CURRENT_JSON"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry-run: no changes applied"
  exit 0
fi

# Idempotent replace via ARM web config (avoids add/remove races).
python3 - "$APP" "$RG" "$DESIRED_JSON" <<'PY'
import json
import subprocess
import sys

app, rg, desired_json = sys.argv[1:]
desired = json.loads(desired_json)

show = subprocess.run(
    [
        "az",
        "functionapp",
        "show",
        "--name",
        app,
        "--resource-group",
        rg,
        "--query",
        "id",
        "-o",
        "tsv",
    ],
    check=True,
    capture_output=True,
    text=True,
)
site_id = show.stdout.strip()
config_id = f"{site_id}/config/web"

get = subprocess.run(
    ["az", "rest", "--method", "get", "--url", f"{config_id}?api-version=2023-12-01"],
    check=True,
    capture_output=True,
    text=True,
)
body = json.loads(get.stdout)
props = body.setdefault("properties", {})
cors = props.setdefault("cors", {})
cors["allowedOrigins"] = desired
cors["supportCredentials"] = False

put = subprocess.run(
    [
        "az",
        "rest",
        "--method",
        "put",
        "--url",
        f"{config_id}?api-version=2023-12-01",
        "--body",
        json.dumps({"properties": props}),
    ],
    check=False,
    capture_output=True,
    text=True,
)
if put.returncode != 0:
    sys.stderr.write(put.stderr or put.stdout)
    raise SystemExit(put.returncode)
print(f"applied platform CORS ({len(desired)} origin(s)) on {app}")
PY

az functionapp cors show --name "$APP" --resource-group "$RG" -o json
