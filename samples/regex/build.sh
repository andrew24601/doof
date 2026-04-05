#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT_DIR/build-regex"
ENTRY_FILE="$SCRIPT_DIR/main.do"
RUN_AFTER_BUILD="${1:-}"

if [[ ! -f "$ROOT_DIR/dist/cli.js" ]]; then
    echo "dist/cli.js is missing; building the compiler first"
    (
        cd "$ROOT_DIR"
        npm run build
    )
fi

DOOF_ARGS=(
    "$ENTRY_FILE"
    -o "$OUT_DIR"
    --include-path "$SCRIPT_DIR"
)

if command -v brew &>/dev/null; then
    NLOHMANN_PREFIX=$(brew --prefix nlohmann-json 2>/dev/null || true)
    if [[ -n "$NLOHMANN_PREFIX" && -f "$NLOHMANN_PREFIX/include/nlohmann/json.hpp" ]]; then
        DOOF_ARGS+=(--include-path "$NLOHMANN_PREFIX/include")
    fi
fi

for dir in /usr/local/include /usr/include; do
    if [[ -f "$dir/nlohmann/json.hpp" ]]; then
        DOOF_ARGS+=(--include-path "$dir")
        break
    fi
done

node "$ROOT_DIR/dist/cli.js" build "${DOOF_ARGS[@]}"

echo "Built $OUT_DIR/a.out"
echo "Run it with: $OUT_DIR/a.out"

if [[ "$RUN_AFTER_BUILD" == "--run" ]]; then
    exec "$OUT_DIR/a.out"
fi