#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_TYPE="${DOOF_SEAHAVEN_TOWERS_BUILD_TYPE:-Release}"
BUILD_DIR="$REPO_ROOT/samples/seahaven-towers/_build"
EMIT_DIR="$REPO_ROOT/build-seahaven-towers"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this script is intended for macOS." >&2
  exit 1
fi

echo "Repo root: $REPO_ROOT"
echo "Build type: $BUILD_TYPE"

cd "$REPO_ROOT"

echo "1/5: Building TypeScript (dist/cli.js)"
npm run build

echo "2/5: Emitting C++ sources to build-seahaven-towers/"
rm -rf "$EMIT_DIR"
node dist/cli.js emit --include-path "$REPO_ROOT" -o "$EMIT_DIR" samples/seahaven-towers/main.do

echo "3/5: Configuring and building CMake project"
mkdir -p "$BUILD_DIR"

CMAKE_ARGS=(
  -S "$REPO_ROOT/samples/seahaven-towers"
  -B "$BUILD_DIR"
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
)

if command -v brew >/dev/null 2>&1; then
  CMAKE_ARGS+=("-DCMAKE_PREFIX_PATH=$(brew --prefix)")
fi

cmake "${CMAKE_ARGS[@]}"
cmake --build "$BUILD_DIR" --config "$BUILD_TYPE"

BUNDLED_APP="$BUILD_DIR/DoofSeahavenTowers.app"
if [ ! -d "$BUNDLED_APP" ] && [ -d "$BUILD_DIR/$BUILD_TYPE/DoofSeahavenTowers.app" ]; then
  BUNDLED_APP="$BUILD_DIR/$BUILD_TYPE/DoofSeahavenTowers.app"
fi

if [ ! -d "$BUNDLED_APP" ]; then
  echo "Error: built app bundle not found: $BUNDLED_APP" >&2
  exit 1
fi

echo "4/5: Copying macOS .app bundle"
APP_OUTPUT_DIR="$REPO_ROOT/build"
APP_DIR="$APP_OUTPUT_DIR/DoofSeahavenTowers.app"
mkdir -p "$APP_OUTPUT_DIR"
rm -rf "$APP_DIR"
cp -R "$BUNDLED_APP" "$APP_DIR"

echo "5/5: Done. App bundle created at: $APP_DIR"

echo "You can run it with:"
echo "open \"$APP_DIR\""

exit 0