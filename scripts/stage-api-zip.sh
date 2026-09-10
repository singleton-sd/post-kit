#!/usr/bin/env bash
# Stage a Function App zip that loads under Azure's classic Node require() resolution.
#
# `pnpm deploy` leaves a pnpm virtual store layout (deps under node_modules/.pnpm).
# Azure Functions does not use pnpm's linker, so transitive packages such as
# `cookie` and `semver` are invisible and `dist/index.js` throws MODULE_NOT_FOUND —
# zero functions register and every route 404s.
#
# Fix: keep injected workspace packages as file: deps, then `npm install --omit=dev`
# to produce a flat node_modules tree.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ZIP="${1:-}"
STAGE="${STAGE_DIR:-$(mktemp -d)}"
export STAGE

if [[ -z "$OUT_ZIP" ]]; then
  echo "usage: $0 <output.zip>" >&2
  exit 1
fi

OUT_ZIP="$(cd "$(dirname "$OUT_ZIP")" && pwd)/$(basename "$OUT_ZIP")"

cd "$ROOT_DIR"

pnpm --filter @singleton-sd/post-kit-email run build
pnpm --filter @singleton-sd/post-kit-types run build
pnpm --filter @singleton-sd/post-kit-api run build

pnpm --filter @singleton-sd/post-kit-api deploy --prod "$STAGE"
cp "$ROOT_DIR/apps/api/host.json" "$STAGE/"
test -f "$STAGE/dist/index.js"
test -d "$STAGE/node_modules/@singleton-sd/post-kit-email"
test -d "$STAGE/node_modules/@singleton-sd/post-kit-types"

mkdir -p "$STAGE/vendor"
rm -rf "$STAGE/vendor/post-kit-email" "$STAGE/vendor/post-kit-types"
# pnpm deploy leaves workspace packages as symlinks into .pnpm — dereference them.
cp -aL "$STAGE/node_modules/@singleton-sd/post-kit-email" "$STAGE/vendor/post-kit-email"
cp -aL "$STAGE/node_modules/@singleton-sd/post-kit-types" "$STAGE/vendor/post-kit-types"
test -f "$STAGE/vendor/post-kit-email/package.json"
test -f "$STAGE/vendor/post-kit-types/package.json"

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const stage = process.env.STAGE;
const pkgPath = path.join(stage, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

pkg.dependencies = pkg.dependencies ?? {};
pkg.dependencies['@singleton-sd/post-kit-email'] = 'file:./vendor/post-kit-email';
pkg.dependencies['@singleton-sd/post-kit-types'] = 'file:./vendor/post-kit-types';
delete pkg.devDependencies;

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
NODE

rm -rf "$STAGE/node_modules"
(
  cd "$STAGE"
  npm install --omit=dev --ignore-scripts
)

(
  cd "$STAGE"
  node -e "require('./dist/index.js'); console.log('stage-api-zip: entrypoint loads')"
)

test -d "$STAGE/node_modules/cookie"
test -d "$STAGE/node_modules/semver"
test -d "$STAGE/node_modules/@singleton-sd/post-kit-email"

rm -f "$OUT_ZIP"
(
  cd "$STAGE"
  zip -qr "$OUT_ZIP" .
)

echo "Wrote $OUT_ZIP"
