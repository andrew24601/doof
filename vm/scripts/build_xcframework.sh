#!/usr/bin/env bash
# Builds an XCFramework for the vm static library (doof-vm)
# Usage: build_xcframework.sh [--build-type Release] [--lib-name doof-vm] [--output-dir build/xcframework]

set -euo pipefail

# Defaults
BUILD_TYPE=Release
LIB_NAME=doof-vm
OUTPUT_DIR="$(pwd)/build/xcframework"
VM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

print_help() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --build-type <Debug|Release>    Build type (default: Release)
  --lib-name <name>               CMake target / library base name (default: doof-vm)
  --output-dir <path>             Output directory for the .xcframework (default: ./build/xcframework)
  -h, --help                      Show this help

This script will:
  - Configure and build the static library for device (iphoneos/arm64)
  - Configure and build the static library for simulator (iphonesimulator x86_64, arm64)
  - Install artifacts to temporary install dirs
  - Create an .xcframework that bundles both libraries and headers

Requirements: cmake, xcodebuild, and a macOS machine with Xcode installed.
EOF
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-type)
      BUILD_TYPE="$2"; shift 2;;
    --lib-name)
      LIB_NAME="$2"; shift 2;;
    --output-dir)
      OUTPUT_DIR="$2"; shift 2;;
    -h|--help)
      print_help; exit 0;;
    *)
      echo "Unknown arg: $1"; print_help; exit 1;;
  esac
done

echo "Building XCFramework for target: ${LIB_NAME} (config: ${BUILD_TYPE})"
echo "Repo vm dir: ${VM_DIR}"
echo "Output dir: ${OUTPUT_DIR}"

mkdir -p "${OUTPUT_DIR}"

DEVICE_BUILD_DIR="${VM_DIR}/build/ios-device"
SIM_BUILD_DIR="${VM_DIR}/build/ios-sim"
DEVICE_INSTALL_DIR="${VM_DIR}/build/install-device"
SIM_INSTALL_DIR="${VM_DIR}/build/install-sim"

rm -rf "${DEVICE_BUILD_DIR}" "${SIM_BUILD_DIR}" "${DEVICE_INSTALL_DIR}" "${SIM_INSTALL_DIR}"
mkdir -p "${DEVICE_BUILD_DIR}" "${SIM_BUILD_DIR}" "${DEVICE_INSTALL_DIR}" "${SIM_INSTALL_DIR}"

echo "Configuring device (iphoneos/arm64)..."
cmake -S "${VM_DIR}" -B "${DEVICE_BUILD_DIR}" -G Xcode \
  -DCMAKE_BUILD_TYPE=${BUILD_TYPE} \
  -DCMAKE_INSTALL_PREFIX="${DEVICE_INSTALL_DIR}" \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphoneos \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
  -DCMAKE_OSX_ARCHITECTURES=arm64

echo "Building device (doof-vm only) and installing..."
cmake --build "${DEVICE_BUILD_DIR}" --config ${BUILD_TYPE} --target ${LIB_NAME}
cmake --install "${DEVICE_BUILD_DIR}" --config ${BUILD_TYPE} --prefix "${DEVICE_INSTALL_DIR}"

echo "Configuring simulator (iphonesimulator x86_64;arm64)..."
cmake -S "${VM_DIR}" -B "${SIM_BUILD_DIR}" -G Xcode \
  -DCMAKE_BUILD_TYPE=${BUILD_TYPE} \
  -DCMAKE_INSTALL_PREFIX="${SIM_INSTALL_DIR}" \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
  -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"

echo "Building simulator (doof-vm only) and installing..."
cmake --build "${SIM_BUILD_DIR}" --config ${BUILD_TYPE} --target ${LIB_NAME}
cmake --install "${SIM_BUILD_DIR}" --config ${BUILD_TYPE} --prefix "${SIM_INSTALL_DIR}"

# Find produced static libs
DEVICE_LIB="$(find "${DEVICE_INSTALL_DIR}" -name "lib${LIB_NAME}.a" | head -n1 || true)"
SIM_LIB="$(find "${SIM_INSTALL_DIR}" -name "lib${LIB_NAME}.a" | head -n1 || true)"

if [[ -z "${DEVICE_LIB}" || -z "${SIM_LIB}" ]]; then
  echo "Error: could not find built static libraries. Device: ${DEVICE_LIB}, Sim: ${SIM_LIB}" >&2
  exit 1
fi

echo "Device lib: ${DEVICE_LIB}"
echo "Sim lib: ${SIM_LIB}"

# Create XCFramework
XCFRAMEWORK_PATH="${OUTPUT_DIR}/${LIB_NAME}.xcframework"
rm -rf "${XCFRAMEWORK_PATH}"

echo "Creating XCFramework at ${XCFRAMEWORK_PATH}"

xcodebuild -create-xcframework \
  -library "${DEVICE_LIB}" -headers "${DEVICE_INSTALL_DIR}/include" \
  -library "${SIM_LIB}" -headers "${SIM_INSTALL_DIR}/include" \
  -output "${XCFRAMEWORK_PATH}"

echo "XCFramework created: ${XCFRAMEWORK_PATH}"

echo "Done. You can now distribute ${XCFRAMEWORK_PATH}."

exit 0
