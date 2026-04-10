#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EMIT_DIR="$REPO_ROOT/samples/solitaire/build"
echo "Repo root: $REPO_ROOT"

cd "$REPO_ROOT"

echo "1/3: Building TypeScript (dist/cli.js)"
npm run build

echo "2/3: Building DoofSolitaire.app with doof build"
rm -rf "$EMIT_DIR"
node dist/cli.js build samples/solitaire

BUNDLED_APP="$EMIT_DIR/DoofSolitaire.app"

if [ ! -d "$BUNDLED_APP" ]; then
  echo "Error: built app bundle not found: $BUNDLED_APP" >&2
  exit 1
fi

echo "3/3: Copying macOS .app bundle"
APP_OUTPUT_DIR="$REPO_ROOT/build"
APP_DIR="$APP_OUTPUT_DIR/DoofSolitaire.app"
mkdir -p "$APP_OUTPUT_DIR"
rm -rf "$APP_DIR"
cp -R "$BUNDLED_APP" "$APP_DIR"

echo "Done. App bundle created at: $APP_DIR"

echo "You can run it with:"
echo "open \"$APP_DIR\""

exit 0
