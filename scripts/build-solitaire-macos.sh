#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_TYPE="${DOOF_SOLITAIRE_BUILD_TYPE:-Release}"
EMIT_DIR="$REPO_ROOT/build-solitaire"
echo "Repo root: $REPO_ROOT"
echo "Build type: $BUILD_TYPE"

cd "$REPO_ROOT"

echo "1/5: Building TypeScript (dist/cli.js)"
npm run build

echo "2/5: Emitting C++ sources to build-solitaire/"
rm -rf "$EMIT_DIR"
node dist/cli.js emit --include-path "$REPO_ROOT" -o "$EMIT_DIR" samples/solitaire/main.do

echo "3/5: Configuring and building CMake project"
mkdir -p samples/solitaire/_build
cd samples/solitaire/_build
cmake .. -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
cmake --build . --config "$BUILD_TYPE"

BUNDLED_APP="$REPO_ROOT/samples/solitaire/_build/DoofSolitaire.app"
if [ ! -d "$BUNDLED_APP" ] && [ -d "$REPO_ROOT/samples/solitaire/_build/$BUILD_TYPE/DoofSolitaire.app" ]; then
  BUNDLED_APP="$REPO_ROOT/samples/solitaire/_build/$BUILD_TYPE/DoofSolitaire.app"
fi

if [ ! -d "$BUNDLED_APP" ]; then
  echo "Error: built app bundle not found: $BUNDLED_APP" >&2
  exit 1
fi

echo "4/5: Copying macOS .app bundle"
APP_OUTPUT_DIR="$REPO_ROOT/build"
APP_DIR="$APP_OUTPUT_DIR/DoofSolitaire.app"
mkdir -p "$APP_OUTPUT_DIR"
rm -rf "$APP_DIR"
cp -R "$BUNDLED_APP" "$APP_DIR"

echo "5/5: Done. App bundle created at: $APP_DIR"

echo "You can run it with:"
echo "open \"$APP_DIR\""

exit 0
