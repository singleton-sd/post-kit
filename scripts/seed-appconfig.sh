#!/usr/bin/env bash
# Seed App Configuration keys if missing. Does not overwrite portal edits.
# KV reference for forwardemail-api-key is idempotently (re)asserted — it is
# a URI pointer, not a secret value.
set -euo pipefail

STORE="${APP_CONFIG_NAME:-ssd-postkit-appcs-prod-ae}"
SEED="${1:-infra/appconfig-seed.json}"
VAULT_URI="${KEY_VAULT_URI:-https://ssd-global-kv-prod-ae.vault.azure.net}"
SECRET_NAME="${FORWARD_EMAIL_SECRET_NAME:-forwardemail-api-key}"

[[ -f "$SEED" ]] || { echo "error: seed file not found: $SEED" >&2; exit 1; }

python3 - "$STORE" "$SEED" "$VAULT_URI" "$SECRET_NAME" <<'PY'
import json
import subprocess
import sys

store, seed_path, vault_uri, secret_name = sys.argv[1:]
seed = json.load(open(seed_path, encoding="utf-8"))


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=False, capture_output=True, text=True)


def key_exists(key: str) -> bool:
    result = run(["az", "appconfig", "kv", "show", "--name", store, "--key", key, "-o", "none"])
    return result.returncode == 0


for key, value in seed.items():
    if key_exists(key):
        print(f"keep {key}")
        continue
    result = run(
        [
            "az",
            "appconfig",
            "kv",
            "set",
            "--name",
            store,
            "--key",
            key,
            "--value",
            value,
            "--yes",
        ]
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    print(f"set {key}")

kv_key = f"secret:{secret_name}"
kv_value = json.dumps({"uri": f"{vault_uri.rstrip('/')}/secrets/{secret_name}"})
result = run(
    [
        "az",
        "appconfig",
        "kv",
        "set",
        "--name",
        store,
        "--key",
        kv_key,
        "--value",
        kv_value,
        "--content-type",
        "application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8",
        "--yes",
    ]
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    raise SystemExit(result.returncode)
print(f"set {kv_key} (Key Vault reference)")
PY
