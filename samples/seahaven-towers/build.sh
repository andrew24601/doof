#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT_DIR/build-seahaven-towers"
BUILD_DIR="$ROOT_DIR/build-seahaven-towers-sdl"
ENTRY_FILE="$SCRIPT_DIR/main.do"
RUN_AFTER_BUILD="${1:-}"

if [[ ! -f "$ROOT_DIR/dist/cli.js" ]]; then
    echo "dist/cli.js is missing; building the compiler first"
    (
        cd "$ROOT_DIR"
        npm run build
    )
fi

rm -rf "$OUT_DIR"

node "$ROOT_DIR/dist/cli.js" emit \
    "$ENTRY_FILE" \
    -o "$OUT_DIR" \
    --include-path "$ROOT_DIR"

cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR"
cmake --build "$BUILD_DIR"

APP_BUNDLE="$BUILD_DIR/DoofSeahavenTowers.app"
APP_BINARY="$BUILD_DIR/DoofSeahavenTowers"

if [[ -d "$APP_BUNDLE" ]]; then
    echo "Built $APP_BUNDLE"
    echo "Run it with: open \"$APP_BUNDLE\""
elif [[ -x "$APP_BINARY" ]]; then
    echo "Built $APP_BINARY"
    echo "Run it with: $APP_BINARY"
fi

if [[ "$RUN_AFTER_BUILD" == "--run" ]]; then
    if [[ -d "$APP_BUNDLE" ]]; then
        open "$APP_BUNDLE"
    else
        exec "$APP_BINARY"
    fi
fi