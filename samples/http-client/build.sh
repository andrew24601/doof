#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT_DIR/build-http-client"
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

if command -v curl-config &>/dev/null; then
    CURL_CFLAGS=$(curl-config --cflags 2>/dev/null || true)
    CURL_LIBS=$(curl-config --libs 2>/dev/null || true)

    for token in $CURL_CFLAGS; do
        case "$token" in
            -I*) DOOF_ARGS+=(--include-path "${token:2}") ;;
            -D*) DOOF_ARGS+=(--define "${token:2}") ;;
            *) DOOF_ARGS+=(--cxxflag "$token") ;;
        esac
    done

    NEXT_IS_FRAMEWORK=0
    for token in $CURL_LIBS; do
        if [[ "$NEXT_IS_FRAMEWORK" == "1" ]]; then
            DOOF_ARGS+=(--framework "$token")
            NEXT_IS_FRAMEWORK=0
            continue
        fi

        case "$token" in
            -L*) DOOF_ARGS+=(--lib-path "${token:2}") ;;
            -l*) DOOF_ARGS+=(--link-lib "${token:2}") ;;
            -framework) NEXT_IS_FRAMEWORK=1 ;;
            *) DOOF_ARGS+=(--ldflag "$token") ;;
        esac
    done
else
    DOOF_ARGS+=(--link-lib curl)
fi

node "$ROOT_DIR/dist/cli.js" build "${DOOF_ARGS[@]}"

echo "Built $OUT_DIR/a.out"
echo "Run it with: $OUT_DIR/a.out"
echo "The sample performs a GET request to https://example.com"

if [[ "$RUN_AFTER_BUILD" == "--run" ]]; then
    exec "$OUT_DIR/a.out"
fi