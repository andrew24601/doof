#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"

echo "Building UnityDoofRemoteRunner in $BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

cmake ..
cmake --build . --config Release

echo "Build finished. Library should be at: $BUILD_DIR/libUnityDoofRemoteRunner.dylib"

if [ "${1-}" = "run-test" ]; then
  if [ -x "$BUILD_DIR/test_remote_runner" ]; then
    echo "Running test_remote_runner..."
    "$BUILD_DIR/test_remote_runner"
  else
    echo "test_remote_runner not found or not executable"
  fi
fi

echo "Done."
