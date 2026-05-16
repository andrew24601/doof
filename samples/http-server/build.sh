#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT_DIR/build-http-server"
ENTRY_FILE="$SCRIPT_DIR/main.do"
RUN_AFTER_BUILD="${1:-}"

if [[ ! -f "$ROOT_DIR/dist/cli.js" ]]; then
    echo "dist/cli.js is missing; building the compiler first"
    (
        cd "$ROOT_DIR"
        npm run build
    )
fi

node "$ROOT_DIR/dist/cli.js" build \
    "$ENTRY_FILE" \
    -o "$OUT_DIR"

echo "Built $OUT_DIR/a.out"
echo "Run it with: $OUT_DIR/a.out"
echo "Then try: curl http://127.0.0.1:8080/health"

if [[ "$RUN_AFTER_BUILD" == "--run" ]]; then
    exec "$OUT_DIR/a.out"
fi