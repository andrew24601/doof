#!/usr/bin/env bash
set -euo pipefail

# rebuild_and_bundle_json_runner.sh
# Builds the json-runner target in the vm CMake project and copies the
# resulting binary into the vscode-extension/runtime directory so the
# extension can bundle the latest VM.
#
# Usage:
#   ./vm/scripts/rebuild_and_bundle_json_runner.sh [build-dir] [--no-extension-build]
#
# Defaults:
#   build-dir: vm/build
#   The script will also run `npm run compile` in vscode-extension unless
#   --no-extension-build is provided.

# Derive paths relative to repository root. The script may be invoked from
# the repository root (./vm/scripts/...), so the repo root is two levels up
# from this script: vm/scripts -> vm -> repo root.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# repo root is two levels up from this script (vm/scripts -> vm -> repo root)
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VM_DIR="${REPO_ROOT}/vm"
BUILD_DIR="${VM_DIR}/build"
EXT_DIR="${REPO_ROOT}/vscode-extension"
RUNTIME_DIR="${EXT_DIR}/runtime"

# Allow overriding build dir via first argument
if [ "$#" -ge 1 ] && [ "$1" != "--no-extension-build" ]; then
  BUILD_DIR="$1"
fi

SKIP_EXT_BUILD=0
for arg in "$@"; do
  if [ "$arg" = "--no-extension-build" ]; then
    SKIP_EXT_BUILD=1
  fi
done

echo "Building json-runner in: ${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"
pushd "${BUILD_DIR}" >/dev/null

# Configure if no build system present (CMakeCache.txt missing)
if [ ! -f CMakeCache.txt ]; then
  echo "Configuring CMake... (source: ${VM_DIR})"
  cmake "${VM_DIR}"
fi

echo "Running build (json-runner)..."
cmake --build . --target json-runner -- -j$(getconf _NPROCESSORS_ONLN || echo 2)

JSON_RUNNER_PATH="${BUILD_DIR}/json-runner"
if [ ! -f "${JSON_RUNNER_PATH}" ]; then
  # Try typical CMake multi-config locations (e.g. Xcode/NinjaMulti-Config)
  CANDIDATES=(
    "${BUILD_DIR}/json-runner"
    "${BUILD_DIR}/bin/json-runner"
    "${BUILD_DIR}/Release/json-runner"
    "${BUILD_DIR}/Debug/json-runner"
    "${BUILD_DIR}/build/json-runner"
  )
  FOUND=0
  for c in "${CANDIDATES[@]}"; do
    if [ -f "${c}" ]; then
      JSON_RUNNER_PATH="${c}"
      FOUND=1
      break
    fi
  done
  if [ ${FOUND} -eq 0 ]; then
    echo "ERROR: json-runner binary not found in ${BUILD_DIR}" >&2
    popd >/dev/null
    exit 2
  fi
fi

echo "Found json-runner at: ${JSON_RUNNER_PATH}"

echo "Copying to extension runtime: ${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"
cp "${JSON_RUNNER_PATH}" "${RUNTIME_DIR}/json-runner"
chmod +x "${RUNTIME_DIR}/json-runner"
echo "Copied and made executable: ${RUNTIME_DIR}/json-runner"

popd >/dev/null

if [ ${SKIP_EXT_BUILD} -eq 0 ]; then
  if [ -f "${EXT_DIR}/package.json" ]; then
    echo "Compiling VS Code extension..."
    pushd "${EXT_DIR}" >/dev/null
    # Prefer npm run compile if available
    if npm --no-git-tag-version run -s compile 2>/dev/null; then
      echo "Extension compiled"
    else
      echo "npm run compile failed or not defined; skipping extension compile"
    fi
    popd >/dev/null
  else
    echo "VS Code extension package.json not found; skipping extension compile"
  fi
else
  echo "Skipping extension compile (--no-extension-build)"
fi

echo "Done."
