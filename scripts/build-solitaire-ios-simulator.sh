#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this script is intended for macOS." >&2
  exit 1
fi

if ! xcrun simctl list devices booted | grep -q "Booted"; then
  echo "Error: boot an iOS simulator first." >&2
  echo "Example:" >&2
  echo "  open -a Simulator" >&2
  echo "  xcrun simctl boot 'iPhone 16'" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "1/2: Building TypeScript (dist/cli.js)"
npm run build

echo "2/2: Building and launching Doof Solitaire on the booted iOS simulator"
node dist/cli.js run \
  --target ios-app \
  samples/solitaire