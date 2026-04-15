#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$ROOT_DIR/build-obj-viewer"
ENTRY_FILE="$SCRIPT_DIR/main.do"
RUN_AFTER_BUILD=0
MODEL_PATH="${SCRIPT_DIR}/models/cube.obj"

if [[ "${1:-}" == "--run" ]]; then
    RUN_AFTER_BUILD=1
    if [[ -n "${2:-}" ]]; then
        MODEL_PATH="$2"
    fi
elif [[ -n "${1:-}" ]]; then
    MODEL_PATH="$1"
fi

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

SDL_FOUND=0
if command -v pkg-config &>/dev/null && pkg-config --exists sdl3; then
    SDL_CFLAGS=$(pkg-config --cflags sdl3 2>/dev/null || true)
    SDL_LIBS=$(pkg-config --libs sdl3 2>/dev/null || true)

    for token in $SDL_CFLAGS; do
        case "$token" in
            -I*) DOOF_ARGS+=(--include-path "${token:2}") ;;
            -D*) DOOF_ARGS+=(--define "${token:2}") ;;
            *) DOOF_ARGS+=(--cxxflag "$token") ;;
        esac
    done

    NEXT_IS_FRAMEWORK=0
    for token in $SDL_LIBS; do
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

    SDL_FOUND=1
elif command -v brew &>/dev/null; then
    SDL_PREFIX=$(brew --prefix sdl3 2>/dev/null || true)
    if [[ -n "$SDL_PREFIX" && -d "$SDL_PREFIX/include/SDL3" && -d "$SDL_PREFIX/lib" ]]; then
        DOOF_ARGS+=(--include-path "$SDL_PREFIX/include")
        DOOF_ARGS+=(--lib-path "$SDL_PREFIX/lib")
        DOOF_ARGS+=(--link-lib SDL3)
        DOOF_ARGS+=(--ldflag "-Wl,-rpath,$SDL_PREFIX/lib")
        SDL_FOUND=1
    fi
fi

if [[ "$SDL_FOUND" != "1" ]]; then
    echo "SDL3 development files were not found. Install SDL3 or make pkg-config aware of it before building this sample." >&2
    exit 1
fi

node "$ROOT_DIR/dist/cli.js" build "${DOOF_ARGS[@]}"

echo "Built $OUT_DIR/a.out"
echo "Run it with: $OUT_DIR/a.out $MODEL_PATH"

if [[ "$RUN_AFTER_BUILD" == "1" ]]; then
    exec "$OUT_DIR/a.out" "$MODEL_PATH"
fi